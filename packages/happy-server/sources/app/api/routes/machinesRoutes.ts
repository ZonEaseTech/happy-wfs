import { eventRouter } from "@/app/events/eventRouter";
import { Fastify } from "../types";
import { z } from "zod";
import { db } from "@/storage/db";
import { log } from "@/utils/log";
import { randomKeyNaked } from "@/utils/randomKeyNaked";
import { allocateUserSeq } from "@/storage/seq";
import { buildNewMachineUpdate, buildUpdateMachineUpdate } from "@/app/events/eventRouter";

export function machinesRoutes(app: Fastify) {
    app.post('/v1/machines', {
        preHandler: app.authenticate,
        schema: {
            body: z.object({
                id: z.string(),
                metadata: z.string(), // Encrypted metadata
                daemonState: z.string().optional(), // Encrypted daemon state
                dataEncryptionKey: z.string().nullish(),
                displayName: z.string().max(120).nullish(),
                isDevice: z.boolean().nullish()
            })
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const { id, metadata, daemonState, dataEncryptionKey, displayName, isDevice } = request.body;

        // Check if machine exists (like sessions do)
        const machine = await db.machine.findFirst({
            where: {
                accountId: userId,
                id: id
            }
        });

        if (machine) {
            // Machine exists — fill the plaintext label when it is still empty,
            // so machines registered by an older CLI get one without
            // re-enrolling. Never overwrite: the CLI only knows the hostname,
            // and a rename in the app must survive every daemon restart.
            // Clearing the rename sets the column back to null, which lets the
            // hostname take over again on the next registration.
            const refresh: { displayName?: string; isDevice?: boolean } = {};
            if (displayName && !machine.displayName) refresh.displayName = displayName;
            // Only ever set the flag from the CLI: clearing it is a user action
            // in the app, and a stale CLI must not undo that.
            if (isDevice === true && !machine.isDevice) refresh.isDevice = true;
            if (Object.keys(refresh).length > 0) {
                await db.machine.update({ where: { id: machine.id }, data: refresh });
                Object.assign(machine, refresh);
            }
            log({ module: 'machines', machineId: id, userId }, 'Found existing machine');
            return reply.send({
                machine: {
                    id: machine.id,
                    displayName: machine.displayName,
                    isDevice: machine.isDevice,
                    metadata: machine.metadata,
                    metadataVersion: machine.metadataVersion,
                    daemonState: machine.daemonState,
                    daemonStateVersion: machine.daemonStateVersion,
                    dataEncryptionKey: machine.dataEncryptionKey ? Buffer.from(machine.dataEncryptionKey).toString('base64') : null,
                    active: machine.active,
                    activeAt: machine.lastActiveAt.getTime(),  // Return as activeAt for API consistency
                    createdAt: machine.createdAt.getTime(),
                    updatedAt: machine.updatedAt.getTime()
                }
            });
        } else {
            // Create new machine
            log({ module: 'machines', machineId: id, userId }, 'Creating new machine');

            const newMachine = await db.machine.create({
                data: {
                    id,
                    accountId: userId,
                    metadata,
                    metadataVersion: 1,
                    daemonState: daemonState || null,
                    daemonStateVersion: daemonState ? 1 : 0,
                    dataEncryptionKey: dataEncryptionKey ? new Uint8Array(Buffer.from(dataEncryptionKey, 'base64')) : undefined,
                    // Default to offline - in case the user does not start daemon
                    active: false,
                    // lastActiveAt and activeAt defaults to now() in schema
                }
            });

            // Emit both new-machine and update-machine events for backward compatibility
            const updSeq1 = await allocateUserSeq(userId);
            const updSeq2 = await allocateUserSeq(userId);
            
            // Emit new-machine event with all data including dataEncryptionKey
            const newMachinePayload = buildNewMachineUpdate(newMachine, updSeq1, randomKeyNaked(12));
            eventRouter.emitUpdate({
                userId,
                payload: newMachinePayload,
                recipientFilter: { type: 'user-scoped-only' }
            });

            // Emit update-machine event for backward compatibility (without dataEncryptionKey)
            const machineMetadata = {
                version: 1,
                value: metadata
            };
            const updatePayload = buildUpdateMachineUpdate(newMachine.id, updSeq2, randomKeyNaked(12), machineMetadata);
            eventRouter.emitUpdate({
                userId,
                payload: updatePayload,
                recipientFilter: { type: 'machine-scoped-only', machineId: newMachine.id }
            });

            return reply.send({
                machine: {
                    id: newMachine.id,
                    metadata: newMachine.metadata,
                    metadataVersion: newMachine.metadataVersion,
                    daemonState: newMachine.daemonState,
                    daemonStateVersion: newMachine.daemonStateVersion,
                    dataEncryptionKey: newMachine.dataEncryptionKey ? Buffer.from(newMachine.dataEncryptionKey).toString('base64') : null,
                    active: newMachine.active,
                    activeAt: newMachine.lastActiveAt.getTime(),  // Return as activeAt for API consistency
                    createdAt: newMachine.createdAt.getTime(),
                    updatedAt: newMachine.updatedAt.getTime()
                }
            });
        }
    });


    // Machines API
    // Lets the app correct the flag for machines enrolled before the CLI
    // started reporting it, without touching the machine itself.
    app.patch('/v1/machines/:id/device-flag', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({ id: z.string() }),
            body: z.object({ isDevice: z.boolean() }),
            response: { 200: z.object({ ok: z.boolean() }) }
        }
    }, async (request, reply) => {
        await db.machine.updateMany({
            where: { id: request.params.id, accountId: request.userId },
            data: { isDevice: request.body.isDevice }
        });
        return reply.send({ ok: true });
    });

    app.get('/v1/machines', {
        preHandler: app.authenticate,
    }, async (request, reply) => {
        const userId = request.userId;

        const machines = await db.machine.findMany({
            where: { accountId: userId },
            orderBy: { lastActiveAt: 'desc' }
        });

        return machines.map(m => ({
            id: m.id,
            displayName: m.displayName,
            isDevice: m.isDevice,
            metadata: m.metadata,
            metadataVersion: m.metadataVersion,
            daemonState: m.daemonState,
            daemonStateVersion: m.daemonStateVersion,
            dataEncryptionKey: m.dataEncryptionKey ? Buffer.from(m.dataEncryptionKey).toString('base64') : null,
            seq: m.seq,
            active: m.active,
            activeAt: m.lastActiveAt.getTime(),
            createdAt: m.createdAt.getTime(),
            updatedAt: m.updatedAt.getTime()
        }));
    });

    // GET /v1/machines/:id - Get single machine by ID
    app.get('/v1/machines/:id', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                id: z.string()
            })
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const { id } = request.params;

        const machine = await db.machine.findFirst({
            where: {
                accountId: userId,
                id: id
            }
        });

        if (!machine) {
            return reply.code(404).send({ error: 'Machine not found' });
        }

        return {
            machine: {
                id: machine.id,
                metadata: machine.metadata,
                metadataVersion: machine.metadataVersion,
                daemonState: machine.daemonState,
                daemonStateVersion: machine.daemonStateVersion,
                dataEncryptionKey: machine.dataEncryptionKey ? Buffer.from(machine.dataEncryptionKey).toString('base64') : null,
                seq: machine.seq,
                active: machine.active,
                activeAt: machine.lastActiveAt.getTime(),
                createdAt: machine.createdAt.getTime(),
                updatedAt: machine.updatedAt.getTime()
            }
        };
    });

    // PATCH /v1/machines/:id — update the plaintext label. The encrypted
    // metadata keeps its own displayName for this machine's own clients; this
    // column is what every other client (and the CLI device list) can read.
    app.patch('/v1/machines/:id', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({ id: z.string() }),
            body: z.object({ displayName: z.string().max(120).nullable() })
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const { id } = request.params;
        const displayName = request.body.displayName?.trim() || null;

        const machine = await db.machine.findFirst({ where: { accountId: userId, id } });
        if (!machine) {
            return reply.code(404).send({ error: 'Machine not found' });
        }
        await db.machine.update({
            where: { accountId_id: { accountId: userId, id } },
            data: { displayName }
        });
        return reply.send({ success: true });
    });

    // DELETE /v1/machines/:id — unenroll a device. Access keys tied to the
    // machine are removed first (they carry a composite FK); sessions that ran
    // on it keep their history untouched.
    app.delete('/v1/machines/:id', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                id: z.string()
            })
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const { id } = request.params;

        const machine = await db.machine.findFirst({
            where: { accountId: userId, id }
        });
        if (!machine) {
            return reply.code(404).send({ error: 'Machine not found' });
        }

        await db.$transaction(async (tx) => {
            await tx.accessKey.deleteMany({ where: { accountId: userId, machineId: id } });
            await tx.machine.delete({ where: { accountId_id: { accountId: userId, id } } });
        });

        log({ module: 'machines', userId, machineId: id }, 'Machine deleted');
        return reply.send({ success: true });
    });

}