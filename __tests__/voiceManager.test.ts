import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { Readable } from 'node:stream';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoiceManager } from '../src/voice';
import type { DiscordService } from '../src/service';
import type { IAgentRuntime } from '@elizaos/core';

const createAudioPlayerMock = vi.fn();
const createAudioResourceMock = vi.fn();
const demuxProbeMock = vi.fn();
const getVoiceConnectionsMock = vi.fn();
const mockVoiceConnections = new Map<string, any>();

vi.mock('@discordjs/voice', () => ({
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
    entersState: vi.fn(),
    getVoiceConnections: (...args: any[]) => getVoiceConnectionsMock(...args),
    joinVoiceChannel: vi.fn(),
}));

vi.mock('prism-media', () => {
    const decoderFactory = vi.fn().mockImplementation(() => new PassThrough());
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
        vi.clearAllMocks();
        mockVoiceConnections.clear();
        getVoiceConnectionsMock.mockReturnValue(mockVoiceConnections);

        createAudioPlayerMock.mockImplementation(() => ({
            play: vi.fn(),
            stop: vi.fn(),
            removeAllListeners: vi.fn(),
            on: vi.fn().mockReturnThis(),
            once: vi.fn().mockReturnThis(),
            state: { status: 'playing' },
        }));
        createAudioResourceMock.mockImplementation(() => ({
            volume: {
                setVolume: vi.fn(),
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
            messageService: { handleMessage: vi.fn() },
            ensureConnection: vi.fn(),
            createMemory: vi.fn(),
            getMemory: vi.fn(),
            getSetting: vi.fn(),
            getService: vi.fn(),
            useModel: vi.fn(),
            evaluate: vi.fn(),
            composeState: vi.fn(),
            emitEvent: vi.fn(),
            getOrCreateUser: vi.fn(),
            processActions: vi.fn(),
            log: vi.fn(),
            logger: {
                warn: vi.fn(),
                error: vi.fn(),
                info: vi.fn(),
                debug: vi.fn(),
                success: vi.fn(),
                trace: vi.fn(),
            },
        } as unknown as IAgentRuntime;

        mockClient = new EventEmitter() as EventEmitter & { user: { id: string } };
        mockClient.user = { id: 'bot-id' };
        (mockClient as any).on = mockClient.on.bind(mockClient);
        (mockClient as any).once = mockClient.once.bind(mockClient);
        (mockClient as any).emit = mockClient.emit.bind(mockClient);
        (mockClient as any).guilds = { cache: new Map(), fetch: vi.fn().mockResolvedValue(new Map()) };

        service = {
            client: mockClient as any,
        } as DiscordService;

        voiceManager = new VoiceManager(service, runtime);
    });

    it('uses demuxProbe output to build audio resource', async () => {
        const guildId = 'guild-1';
        const mockSubscription = {
            unsubscribe: vi.fn(),
            player: null,
            connection: null,
        };
        const connection = {
            subscribe: vi.fn().mockReturnValue(mockSubscription),
            receiver: { speaking: new EventEmitter(), subscribe: vi.fn() },
            state: { status: 'ready' },
            joinConfig: { guildId },
        };
        voiceManager['connections'].set(guildId, connection as any);

        const originalStream = new PassThrough();
        const demuxedStream = new PassThrough();
        demuxProbeMock.mockResolvedValue({ stream: demuxedStream, type: 'opus' });

        // Start playback but don't await fully - we just want to check setup
        const playPromise = voiceManager.playAudio(originalStream, { guildId });

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

        const connection = {
            receiver: {
                subscribe: vi.fn().mockReturnValue(receiveStream),
            },
            joinConfig: { guildId },
        };

        // Set up the mock to return connection for the correct guild ID
        mockVoiceConnections.set(guildId, connection);

        const warnSpy = vi.spyOn(runtime.logger, 'warn').mockImplementation(() => { });
        const emitSpy = vi.spyOn(mockClient, 'emit');

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
                members: { fetch: vi.fn().mockResolvedValue(null), me: null },
            },
            members: {
                get: vi.fn().mockReturnValue({ user: { bot: false } }),
            },
        };

        await (voiceManager as any).monitorMember(member, channel);

        // Check that no warning about empty stream was logged
        const warningCalls = warnSpy.mock.calls;
        const hasEmptyStreamWarning = warningCalls.some((call) => {
            const msg = call[0];
            return typeof msg === 'object' && JSON.stringify(msg).includes('No receiveStream');
        });
        expect(hasEmptyStreamWarning).toBe(false);

        // Verify userStream event was emitted
        expect(emitSpy).toHaveBeenCalledWith('userStream', 'user-123', 'Listener', 'listener', channel, expect.anything());

        warnSpy.mockRestore();
        emitSpy.mockRestore();
    });
});

