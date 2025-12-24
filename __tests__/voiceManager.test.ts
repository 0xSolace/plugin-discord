import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { Readable } from 'node:stream';
import { describe, it, expect, mock, beforeEach, spyOn } from 'bun:test';
import { VoiceManager } from '../src/voice';
import type { DiscordService } from '../src/service';
import type { IAgentRuntime } from '@elizaos/core';

const createAudioPlayerMock = mock(() => undefined);
const createAudioResourceMock = mock(() => undefined);
const demuxProbeMock = mock(() => undefined);
const getVoiceConnectionsMock = mock(() => undefined);
const mockVoiceConnections = new Map<string, any>();

mock.module('@discordjs/voice', () => ({
    NoSubscriberBehavior: { Pause: 'pause' },
    StreamType: { Arbitrary: 'arbitrary', Opus: 'opus' },
    VoiceConnectionStatus: {
        Ready: 'ready',
        Signalling: 'signalling',
        Connecting: 'connecting',
        Disconnected: 'disconnected',
        Destroyed: 'destroyed',
    },
    createAudioPlayer: (...args: any[]) => createAudioPlayerMock(...args),
    createAudioResource: (...args: any[]) => createAudioResourceMock(...args),
    demuxProbe: (...args: any[]) => demuxProbeMock(...args),
    entersState: mock(() => undefined),
    getVoiceConnections: (...args: any[]) => getVoiceConnectionsMock(...args),
    joinVoiceChannel: mock(() => undefined),
}));

mock.module('prism-media', () => {
    const decoderFactory = mock(() => new PassThrough());
    const mockModule = {
        opus: {
            Decoder: decoderFactory,
        },
    };
    return {
        default: mockModule,
        ...mockModule,
    };
});

describe('VoiceManager audio pipeline', () => {
    let runtime: IAgentRuntime;
    let service: DiscordService;
    let mockClient: EventEmitter & { user: { id: string } };
    let voiceManager: VoiceManager;

    beforeEach(() => {
        // Clear mocks
        createAudioPlayerMock.mockClear();
        createAudioResourceMock.mockClear();
        demuxProbeMock.mockClear();
        getVoiceConnectionsMock.mockClear();
        mockVoiceConnections.clear();
        getVoiceConnectionsMock.mockReturnValue(mockVoiceConnections);

        createAudioPlayerMock.mockImplementation(() => ({
            play: mock(() => undefined),
            stop: mock(() => undefined),
            removeAllListeners: mock(() => undefined),
            on: mock(function(this: any) { return this; }),
            once: mock(function(this: any) { return this; }),
            state: { status: 'playing' },
        }));
        createAudioResourceMock.mockImplementation(() => ({
            volume: {
                setVolume: mock(() => undefined),
                volume: 1.0,
            },
            playbackDuration: 0,
            started: true,
            silenceRemaining: -1,
        }));
        demuxProbeMock.mockReset();

        runtime = {
            agentId: 'agent-1',
            character: { name: 'TestAgent', settings: {} },
            messageService: { handleMessage: mock(() => undefined) },
            ensureConnection: mock(() => undefined),
            createMemory: mock(() => undefined),
            getMemory: mock(() => undefined),
            getSetting: mock(() => undefined),
            getService: mock(() => undefined),
            useModel: mock(() => undefined),
            evaluate: mock(() => undefined),
            composeState: mock(() => undefined),
            emitEvent: mock(() => undefined),
            getOrCreateUser: mock(() => undefined),
            processActions: mock(() => undefined),
            log: mock(() => undefined),
            logger: {
                warn: mock(() => undefined),
                error: mock(() => undefined),
                info: mock(() => undefined),
                debug: mock(() => undefined),
                success: mock(() => undefined),
                trace: mock(() => undefined),
            },
        } as unknown as IAgentRuntime;

        mockClient = new EventEmitter() as EventEmitter & { user: { id: string } };
        mockClient.user = { id: 'bot-id' };
        (mockClient as any).on = mockClient.on.bind(mockClient);
        (mockClient as any).once = mockClient.once.bind(mockClient);
        (mockClient as any).emit = mockClient.emit.bind(mockClient);
        (mockClient as any).guilds = { cache: new Map(), fetch: mock(() => Promise.resolve(new Map())) };

        service = {
            client: mockClient as any,
        } as DiscordService;

        voiceManager = new VoiceManager(service, runtime);
    });

    it('uses demuxProbe output to build audio resource', async () => {
        const guildId = 'guild-1';
        const mockSubscription = {
            unsubscribe: mock(() => undefined),
            player: null,
            connection: null,
        };
        const subscribeMock = mock(() => mockSubscription);
        const connection = {
            subscribe: subscribeMock,
            receiver: { speaking: new EventEmitter(), subscribe: mock(() => undefined) },
            state: { status: 'ready' },
            joinConfig: { guildId },
        };
        voiceManager['connections'].set(guildId, connection as any);

        const originalStream = new PassThrough();
        const demuxedStream = new PassThrough();
        demuxProbeMock.mockResolvedValue({ stream: demuxedStream, type: 'opus' });

        // Start playback but don't await fully - we just want to check setup
        void voiceManager.playAudio(originalStream, { guildId });

        // Wait a bit for async operations
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(demuxProbeMock).toHaveBeenCalledWith(originalStream);
        expect(createAudioResourceMock).toHaveBeenCalledWith(demuxedStream, { inputType: 'opus', inlineVolume: true });

        // Clean up
        originalStream.destroy();
        demuxedStream.destroy();
    });

    it('continues monitoring even when receive stream is initially empty', async () => {
        const guildId = 'guild-2';
        const receiveStream = new PassThrough() as Readable & { readableLength: number };
        // Ensure stream has some length to pass the check
        Object.defineProperty(receiveStream, 'readableLength', { value: 1, writable: true });

        const receiverSubscribeMock = mock(() => receiveStream);
        const connection = {
            receiver: {
                subscribe: receiverSubscribeMock,
            },
            joinConfig: { guildId },
        };

        // Set up the mock to return connection for the correct guild ID
        mockVoiceConnections.set(guildId, connection);

        const warnSpy = spyOn(runtime.logger, 'warn').mockImplementation(() => { });
        const emitSpy = spyOn(mockClient, 'emit');

        const membersFetchMock = mock(() => Promise.resolve(null));
        const membersGetMock = mock(() => ({ user: { bot: false } }));
        const member = {
            id: 'user-123',
            user: { username: 'listener', displayName: 'Listener', bot: false },
            guild: { id: guildId },
            displayName: 'Listener',
        };
        const channel = {
            id: 'channel-1',
            name: 'Test Channel',
            guild: {
                id: guildId,
                name: 'Guild',
                members: { fetch: membersFetchMock, me: null },
            },
            members: {
                get: membersGetMock,
            },
        };

        await (voiceManager as any).monitorMember(member, channel);

        // Check that no warning about empty stream was logged
        const warningCalls = (warnSpy as any).mock.calls;
        const hasEmptyStreamWarning = warningCalls.some((call: any[]) => {
            const msg = call[0];
            return typeof msg === 'object' && JSON.stringify(msg).includes('No receiveStream');
        });
        expect(hasEmptyStreamWarning).toBe(false);

        // Verify userStream event was emitted
        expect(emitSpy).toHaveBeenCalledWith('userStream', 'user-123', 'Listener', 'listener', channel, expect.anything());

        (warnSpy as any).mockRestore();
        (emitSpy as any).mockRestore();
    });
});

