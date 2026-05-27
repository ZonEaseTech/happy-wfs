export type PortProxyProtocol = 'http';

export type PortProxyHttpRequest = {
    method: string;
    path: string;
    search: string;
    headers: Record<string, string>;
    bodyBase64: string;
    targetHost: '127.0.0.1' | 'localhost' | '::1';
    targetPort: number;
    protocol: PortProxyProtocol;
};

export type PortProxyHttpResponse = {
    status: number;
    headers: Record<string, string | string[]>;
    bodyBase64: string;
};
