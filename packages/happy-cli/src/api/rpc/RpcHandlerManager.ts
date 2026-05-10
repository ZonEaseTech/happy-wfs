/**
 * Generic RPC handler manager for session and machine clients
 * Manages RPC method registration, encryption/decryption, and handler execution
 */

import { logger as defaultLogger } from '@/ui/logger';
import { decodeBase64, encodeBase64, encrypt, decrypt } from '@/api/encryption';
import {
    RpcHandler,
    RpcHandlerMap,
    RpcRequest,
    RpcHandlerConfig,
} from './types';
import { Socket } from 'socket.io-client';

/** Listener for arbitrary (non-RPC) socket events. The manager re-attaches these on every reconnect. */
export type SocketEventListener = (...args: any[]) => void;

export class RpcHandlerManager {
    private handlers: RpcHandlerMap = new Map();
    private readonly scopePrefix: string;
    private readonly encryptionKey: Uint8Array;
    private readonly encryptionVariant: 'legacy' | 'dataKey';
    private readonly logger: (message: string, data?: any) => void;
    private socket: Socket | null = null;
    /** Non-RPC socket event listeners registered by feature modules (e.g. pty-input). */
    private socketListeners: Map<string, Set<SocketEventListener>> = new Map();

    constructor(config: RpcHandlerConfig) {
        this.scopePrefix = config.scopePrefix;
        this.encryptionKey = config.encryptionKey;
        this.encryptionVariant = config.encryptionVariant;
        this.logger = config.logger || ((msg, data) => defaultLogger.debug(msg, data));
    }

    /** Encryption key — exposed so feature modules can encrypt outbound non-RPC frames. */
    getEncryptionKey(): Uint8Array {
        return this.encryptionKey;
    }

    /** Encryption variant — companion to getEncryptionKey() for outbound frame encryption. */
    getEncryptionVariant(): 'legacy' | 'dataKey' {
        return this.encryptionVariant;
    }

    /** Current socket reference (or null if disconnected). */
    getSocket(): Socket | null {
        return this.socket;
    }

    /**
     * Register a non-RPC socket event listener (e.g. `pty-input`). Stored so the
     * manager can re-attach it on every reconnect — RPC handlers already use the
     * same pattern via `rpc-register` emit.
     */
    registerSocketEvent(eventName: string, listener: SocketEventListener): void {
        let set = this.socketListeners.get(eventName);
        if (!set) {
            set = new Set();
            this.socketListeners.set(eventName, set);
        }
        if (set.has(listener)) return;
        set.add(listener);
        if (this.socket) {
            this.socket.off(eventName, listener);
            this.socket.on(eventName, listener);
        }
    }

    /**
     * Register an RPC handler for a specific method
     * @param method - The method name (without prefix)
     * @param handler - The handler function
     */
    registerHandler<TRequest = any, TResponse = any>(
        method: string,
        handler: RpcHandler<TRequest, TResponse>
    ): void {
        const prefixedMethod = this.getPrefixedMethod(method);

        // Store the handler
        this.handlers.set(prefixedMethod, handler);

        if (this.socket) {
            this.socket.emit('rpc-register', { method: prefixedMethod });
        }
    }

    /**
     * Handle an incoming RPC request
     * @param request - The RPC request data
     * @param callback - The response callback
     */
    async handleRequest(
        request: RpcRequest,
    ): Promise<any> {
        try {
            const handler = this.handlers.get(request.method);

            if (!handler) {
                this.logger('[RPC] [ERROR] Method not found', { method: request.method });
                const errorResponse = { error: 'Method not found' };
                const encryptedError = encodeBase64(encrypt(this.encryptionKey, this.encryptionVariant, errorResponse));
                return encryptedError;
            }

            // Server-originated RPC calls (e.g. orchestrator dispatch/cancel) send params
            // as plain objects. Client-originated calls (e.g. spawn-session from mobile app)
            // send params as base64-encrypted strings. Detect and handle both.
            const isPlaintext = typeof request.params !== 'string';
            const decryptedParams = isPlaintext
                ? request.params
                : decrypt(this.encryptionKey, this.encryptionVariant, decodeBase64(request.params));

            // Call the handler
            this.logger('[RPC] Calling handler', { method: request.method });
            const result = await handler(decryptedParams);
            this.logger('[RPC] Handler returned', { method: request.method, hasResult: result !== undefined });

            // Plaintext requests get plaintext responses
            if (isPlaintext) {
                return result;
            }

            // Check if handler returned a pre-encrypted response (used for OpenClaw chat.history)
            if (result && typeof result === 'object' && '__preEncrypted' in result && result.__preEncrypted === true) {
                this.logger('[RPC] Handler returned pre-encrypted response', { method: request.method });
                return (result as { __preEncrypted: true; data: string }).data;
            }

            // Encrypt and return the response
            const encryptedResponse = encodeBase64(encrypt(this.encryptionKey, this.encryptionVariant, result));
            this.logger('[RPC] Sending encrypted response', { method: request.method, responseLength: encryptedResponse.length });
            return encryptedResponse;
        } catch (error) {
            this.logger('[RPC] [ERROR] Error handling request', { error });
            const errorResponse = {
                error: error instanceof Error ? error.message : 'Unknown error'
            };
            // For plaintext requests, return plain error; for encrypted, return encrypted error
            if (typeof request.params !== 'string') {
                return errorResponse;
            }
            return encodeBase64(encrypt(this.encryptionKey, this.encryptionVariant, errorResponse));
        }
    }

    onSocketConnect(socket: Socket): void {
        this.socket = socket;
        for (const [prefixedMethod] of this.handlers) {
            socket.emit('rpc-register', { method: prefixedMethod });
        }
        // Re-attach non-RPC event listeners across reconnects.
        // socket.io reuses the same Socket instance across reconnects, so the
        // previously-attached listener is still on the EventEmitter — adding
        // a new one without removing the old causes accumulation. For
        // streaming events like pty-input that fires per keystroke, every
        // reconnect doubled the listener count, so 1 keystroke became N
        // writes to the PTY (visible as duplicate echo: type "l" → "ll").
        for (const [eventName, set] of this.socketListeners) {
            for (const listener of set) {
                socket.off(eventName, listener);
                socket.on(eventName, listener);
            }
        }
    }

    onSocketDisconnect(): void {
        // socket.off bookkeeping isn't strictly necessary because socket.io
        // discards listeners on disconnect, but we null out so getSocket()
        // accurately reports availability.
        this.socket = null;
    }

    /**
     * Get the number of registered handlers
     */
    getHandlerCount(): number {
        return this.handlers.size;
    }

    /**
     * Check if a handler is registered
     * @param method - The method name (without prefix)
     */
    hasHandler(method: string): boolean {
        const prefixedMethod = this.getPrefixedMethod(method);
        return this.handlers.has(prefixedMethod);
    }

    /**
     * Clear all handlers
     */
    clearHandlers(): void {
        this.handlers.clear();
        this.logger('Cleared all RPC handlers');
    }

    /**
     * Get the prefixed method name
     * @param method - The method name
     */
    private getPrefixedMethod(method: string): string {
        return `${this.scopePrefix}:${method}`;
    }
}

/**
 * Factory function to create an RPC handler manager
 */
export function createRpcHandlerManager(config: RpcHandlerConfig): RpcHandlerManager {
    return new RpcHandlerManager(config);
}