import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mockHasRoleAccess = vi.fn();

vi.mock("@miladyai/agent/security/access", () => ({
  hasRoleAccess: mockHasRoleAccess,
}));

vi.mock("@elizaos/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@elizaos/core")>();
  return {
    ...actual,
    createUniqueUuid: vi.fn((_rt, id) => `uuid-${id}`),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
});

import {
  handleSlashCommand,
  addCommand,
  removeCommand,
} from "../slash-commands";
import type { ChatInputCommandInteraction } from "discord.js";

function makeInteraction(commandName: string): ChatInputCommandInteraction {
  return {
    commandName,
    user: { id: "user-123", username: "testuser" },
    channelId: "channel-456",
    guild: null,
    replied: false,
    deferred: false,
    reply: vi.fn(),
    editReply: vi.fn(),
    options: { getString: vi.fn(), getNumber: vi.fn() },
  } as unknown as ChatInputCommandInteraction;
}

function makeRuntime() {
  return {
    agentId: "agent-1",
    getSetting: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    character: { name: "TestBot" },
  } as never;
}

describe("slash command role gating", () => {
  beforeEach(() => {
    mockHasRoleAccess.mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    removeCommand("test-role-cmd");
    vi.restoreAllMocks();
  });

  it("blocks a command when the user lacks the required role", async () => {
    mockHasRoleAccess.mockResolvedValue(false);

    addCommand({
      name: "test-role-cmd",
      description: "Test command",
      requiredRole: "ADMIN",
      ephemeral: true,
      execute: vi.fn(),
    });

    const interaction = makeInteraction("test-role-cmd");
    await handleSlashCommand(interaction, makeRuntime(), {
      entityId: "entity-user-123",
      roomId: "room-channel-456",
    });

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("ADMIN"),
        ephemeral: true,
      }),
    );
    expect(mockHasRoleAccess).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entityId: "entity-user-123" }),
      "ADMIN",
    );
  });

  it("allows a command when the user has the required role", async () => {
    mockHasRoleAccess.mockResolvedValue(true);
    const executeFn = vi.fn();

    addCommand({
      name: "test-role-cmd",
      description: "Test command",
      requiredRole: "ADMIN",
      ephemeral: true,
      execute: executeFn,
    });

    const interaction = makeInteraction("test-role-cmd");
    await handleSlashCommand(interaction, makeRuntime(), {
      entityId: "entity-user-123",
      roomId: "room-channel-456",
    });

    expect(executeFn).toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("ADMIN"),
      }),
    );
  });

  it("skips role check when no requiredRole is set", async () => {
    const executeFn = vi.fn();

    addCommand({
      name: "test-role-cmd",
      description: "Test command",
      ephemeral: true,
      execute: executeFn,
    });

    const interaction = makeInteraction("test-role-cmd");
    await handleSlashCommand(interaction, makeRuntime(), {
      entityId: "entity-user-123",
      roomId: "room-channel-456",
    });

    expect(mockHasRoleAccess).not.toHaveBeenCalled();
    expect(executeFn).toHaveBeenCalled();
  });

  it("skips role check when requiredRole is GUEST", async () => {
    const executeFn = vi.fn();

    addCommand({
      name: "test-role-cmd",
      description: "Test command",
      requiredRole: "GUEST",
      ephemeral: true,
      execute: executeFn,
    });

    const interaction = makeInteraction("test-role-cmd");
    await handleSlashCommand(interaction, makeRuntime(), {
      entityId: "entity-user-123",
      roomId: "room-channel-456",
    });

    expect(mockHasRoleAccess).not.toHaveBeenCalled();
    expect(executeFn).toHaveBeenCalled();
  });

  it("allows through when no context is provided (lenient fallback)", async () => {
    const executeFn = vi.fn();

    addCommand({
      name: "test-role-cmd",
      description: "Test command",
      requiredRole: "OWNER",
      ephemeral: true,
      execute: executeFn,
    });

    const interaction = makeInteraction("test-role-cmd");
    // No context passed — should fall through
    await handleSlashCommand(interaction, makeRuntime());

    expect(mockHasRoleAccess).not.toHaveBeenCalled();
    expect(executeFn).toHaveBeenCalled();
  });
});
