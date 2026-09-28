/**
 * Handler-invocation tests for the tool call dispatcher in src/mcp-server.ts.
 *
 * Replaces test/index.test.ts, which asserted only against locally-declared
 * literal arrays/objects (e.g. `expect(expectedTools).toContain(...)`) and
 * never touched real server code. Drives the real Server over a linked
 * in-memory transport pair (same pattern as test/mcp-apps.test.ts), mocking
 * @wyre-technology/node-datto-bcdr so each test asserts the exact outbound
 * call shape sent to the underlying SDK and the resulting tool-result
 * transformation -- for every tool except datto_bcdr_get_device, whose
 * request/response shape is already covered by test/mcp-apps.test.ts.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp-server.js";

const {
  mockDevicesList,
  mockDevicesGet,
  mockAssetsList,
  mockAssetsGet,
  mockBackupsList,
  mockScreenshotsList,
  mockScreenshotsGetImage,
  mockOffsiteGet,
  mockAlertsListAll,
  mockActivityListAll,
} = vi.hoisted(() => ({
  mockDevicesList: vi.fn(),
  mockDevicesGet: vi.fn(),
  mockAssetsList: vi.fn(),
  mockAssetsGet: vi.fn(),
  mockBackupsList: vi.fn(),
  mockScreenshotsList: vi.fn(),
  mockScreenshotsGetImage: vi.fn(),
  mockOffsiteGet: vi.fn(),
  mockAlertsListAll: vi.fn(),
  mockActivityListAll: vi.fn(),
}));

vi.mock("@wyre-technology/node-datto-bcdr", () => ({
  DattoBcdrClient: class {
    devices = { list: mockDevicesList, get: mockDevicesGet };
    assets = { list: mockAssetsList, get: mockAssetsGet };
    backups = { list: mockBackupsList };
    screenshots = { list: mockScreenshotsList, getImage: mockScreenshotsGetImage };
    offsite = { get: mockOffsiteGet };
    alerts = { listAll: mockAlertsListAll };
    activity = { listAll: mockActivityListAll };
  },
}));

const ALL_MOCKS = [
  mockDevicesList,
  mockDevicesGet,
  mockAssetsList,
  mockAssetsGet,
  mockBackupsList,
  mockScreenshotsList,
  mockScreenshotsGetImage,
  mockOffsiteGet,
  mockAlertsListAll,
  mockActivityListAll,
];

const CREDS = { publicKey: "public-key", privateKey: "private-key" };

async function connectClient(
  creds?: { publicKey: string; privateKey: string }
): Promise<Client> {
  const server = createMcpServer(creds);
  const client = new Client({ name: "test-host", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

async function* toAsyncIterable<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

type ToolResult = { isError?: boolean; content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> };

function text(result: ToolResult): string {
  return result.content[0]?.text ?? "";
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const m of ALL_MOCKS) m.mockReset();
});

describe("tool surface", () => {
  it("exposes exactly the 10 documented tools", async () => {
    const client = await connectClient(CREDS);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "datto_bcdr_list_devices",
        "datto_bcdr_get_device",
        "datto_bcdr_list_assets",
        "datto_bcdr_get_asset",
        "datto_bcdr_list_backups",
        "datto_bcdr_list_screenshots",
        "datto_bcdr_get_screenshot",
        "datto_bcdr_get_offsite_status",
        "datto_bcdr_list_alerts",
        "datto_bcdr_list_activity",
      ].sort()
    );
  });
});

describe("missing credentials", () => {
  it("returns an isError result instead of calling the API client", async () => {
    vi.stubEnv("DATTO_BCDR_PUBLIC_KEY", "");
    vi.stubEnv("DATTO_BCDR_PRIVATE_KEY", "");
    const client = await connectClient();
    const result = (await client.callTool({
      name: "datto_bcdr_list_devices",
      arguments: {},
    })) as ToolResult;
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/No API credentials provided/);
    expect(mockDevicesList).not.toHaveBeenCalled();
  });
});

describe("datto_bcdr_list_devices", () => {
  it("defaults page/perPage and passes through the SDK response", async () => {
    mockDevicesList.mockResolvedValue({
      items: [{ serialNumber: "D1" }],
      pagination: { page: 1, perPage: 250, totalPages: 1, totalItems: 1 },
    });
    const client = await connectClient(CREDS);
    const result = (await client.callTool({
      name: "datto_bcdr_list_devices",
      arguments: {},
    })) as ToolResult;

    expect(mockDevicesList).toHaveBeenCalledWith({ page: 1, perPage: 250 });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result))).toEqual({
      items: [{ serialNumber: "D1" }],
      pagination: { page: 1, perPage: 250, totalPages: 1, totalItems: 1 },
    });
  });

  it("forwards explicit page/perPage", async () => {
    mockDevicesList.mockResolvedValue({ items: [], pagination: {} });
    const client = await connectClient(CREDS);
    await client.callTool({
      name: "datto_bcdr_list_devices",
      arguments: { page: 3, perPage: 50 },
    });
    expect(mockDevicesList).toHaveBeenCalledWith({ page: 3, perPage: 50 });
  });

  it("returns an isError result instead of throwing when the client rejects", async () => {
    mockDevicesList.mockRejectedValue(new Error("upstream 500"));
    const client = await connectClient(CREDS);
    const result = (await client.callTool({
      name: "datto_bcdr_list_devices",
      arguments: {},
    })) as ToolResult;
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("Error: upstream 500");
  });
});

describe("datto_bcdr_get_device", () => {
  it("calls devices.get with the exact serial number", async () => {
    mockDevicesGet.mockResolvedValue({ serialNumber: "D42" });
    const client = await connectClient(CREDS);
    await client.callTool({
      name: "datto_bcdr_get_device",
      arguments: { serialNumber: "D42" },
    });
    expect(mockDevicesGet).toHaveBeenCalledWith("D42");
  });
});

describe("datto_bcdr_list_assets", () => {
  it("forwards the serial number to assets.list", async () => {
    mockAssetsList.mockResolvedValue({ items: [{ agentId: "a1" }], pagination: {} });
    const client = await connectClient(CREDS);
    const result = (await client.callTool({
      name: "datto_bcdr_list_assets",
      arguments: { serialNumber: "D1" },
    })) as ToolResult;
    expect(mockAssetsList).toHaveBeenCalledWith("D1");
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result))).toEqual({ items: [{ agentId: "a1" }], pagination: {} });
  });

  it("errors instead of calling the client when serialNumber is omitted and elicitation is unavailable", async () => {
    const client = await connectClient(CREDS);
    const result = (await client.callTool({
      name: "datto_bcdr_list_assets",
      arguments: {},
    })) as ToolResult;
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("Error: serialNumber is required.");
    expect(mockAssetsList).not.toHaveBeenCalled();
  });
});

describe("datto_bcdr_get_asset", () => {
  it("calls assets.get with serialNumber and agentId", async () => {
    mockAssetsGet.mockResolvedValue({ agentId: "a1", hostname: "web-01" });
    const client = await connectClient(CREDS);
    const result = (await client.callTool({
      name: "datto_bcdr_get_asset",
      arguments: { serialNumber: "D1", agentId: "a1" },
    })) as ToolResult;
    expect(mockAssetsGet).toHaveBeenCalledWith("D1", "a1");
    expect(JSON.parse(text(result))).toEqual({ agentId: "a1", hostname: "web-01" });
  });
});

describe("datto_bcdr_list_backups", () => {
  it("calls backups.list with serialNumber and agentId", async () => {
    mockBackupsList.mockResolvedValue({ items: [{ epoch: 1000 }], pagination: {} });
    const client = await connectClient(CREDS);
    await client.callTool({
      name: "datto_bcdr_list_backups",
      arguments: { serialNumber: "D1", agentId: "a1" },
    });
    expect(mockBackupsList).toHaveBeenCalledWith("D1", "a1");
  });
});

describe("datto_bcdr_list_screenshots", () => {
  it("calls screenshots.list with serialNumber and agentId", async () => {
    mockScreenshotsList.mockResolvedValue({ items: [{ epoch: 1000, status: "verified" }], pagination: {} });
    const client = await connectClient(CREDS);
    await client.callTool({
      name: "datto_bcdr_list_screenshots",
      arguments: { serialNumber: "D1", agentId: "a1" },
    });
    expect(mockScreenshotsList).toHaveBeenCalledWith("D1", "a1");
  });
});

describe("datto_bcdr_get_screenshot", () => {
  it("returns base64 image content for a real Buffer response", async () => {
    mockScreenshotsGetImage.mockResolvedValue(Buffer.from("fake-png-bytes"));
    const client = await connectClient(CREDS);
    const result = (await client.callTool({
      name: "datto_bcdr_get_screenshot",
      arguments: { serialNumber: "D1", agentId: "a1", epoch: 1700000000 },
    })) as ToolResult;
    expect(mockScreenshotsGetImage).toHaveBeenCalledWith("D1", "a1", 1700000000);
    expect(result.content[0].type).toBe("image");
    expect(result.content[0].mimeType).toBe("image/png");
    expect(result.content[0].data).toBe(Buffer.from("fake-png-bytes").toString("base64"));
  });

  it("converts a non-Buffer ArrayBuffer-like response to base64", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    mockScreenshotsGetImage.mockResolvedValue(bytes.buffer);
    const client = await connectClient(CREDS);
    const result = (await client.callTool({
      name: "datto_bcdr_get_screenshot",
      arguments: { serialNumber: "D1", agentId: "a1", epoch: 1 },
    })) as ToolResult;
    expect(result.content[0].data).toBe(Buffer.from(bytes.buffer).toString("base64"));
  });
});

describe("datto_bcdr_get_offsite_status", () => {
  it("calls offsite.get with the serial number", async () => {
    mockOffsiteGet.mockResolvedValue({ syncState: "synced" });
    const client = await connectClient(CREDS);
    const result = (await client.callTool({
      name: "datto_bcdr_get_offsite_status",
      arguments: { serialNumber: "D1" },
    })) as ToolResult;
    expect(mockOffsiteGet).toHaveBeenCalledWith("D1");
    expect(JSON.parse(text(result))).toEqual({ syncState: "synced" });
  });

  it("returns an isError result instead of throwing when the client rejects", async () => {
    mockOffsiteGet.mockRejectedValue(new Error("device not found"));
    const client = await connectClient(CREDS);
    const result = (await client.callTool({
      name: "datto_bcdr_get_offsite_status",
      arguments: { serialNumber: "D1" },
    })) as ToolResult;
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("Error: device not found");
  });
});

describe("datto_bcdr_list_alerts", () => {
  it("filters by the given since/until window and normalizes seconds vs ms timestamps", async () => {
    // sinceMs..untilMs = 2026-01-02T00:00:00Z .. 2026-01-04T00:00:00Z
    mockAlertsListAll.mockReturnValue(
      toAsyncIterable([
        { id: "before", createdAt: Math.floor(new Date("2026-01-01T00:00:00Z").getTime() / 1000) }, // seconds, before window
        { id: "in-window-seconds", createdAt: Math.floor(new Date("2026-01-03T00:00:00Z").getTime() / 1000) }, // seconds, in window
        { id: "in-window-ms", createdAt: new Date("2026-01-03T12:00:00Z").getTime() }, // ms, in window
        { id: "after", createdAt: new Date("2026-01-05T00:00:00Z").getTime() }, // ms, after window
      ])
    );
    const client = await connectClient(CREDS);
    const result = (await client.callTool({
      name: "datto_bcdr_list_alerts",
      arguments: { since: "2026-01-02T00:00:00Z", until: "2026-01-04T00:00:00Z" },
    })) as ToolResult;

    expect(mockAlertsListAll).toHaveBeenCalledWith();
    const ids = (JSON.parse(text(result)) as Array<{ id: string }>).map((a) => a.id);
    expect(ids.sort()).toEqual(["in-window-ms", "in-window-seconds"]);
  });

  it("returns everything unfiltered when since/until are omitted and elicitation is unavailable", async () => {
    mockAlertsListAll.mockReturnValue(
      toAsyncIterable([{ id: "a1", createdAt: 1 }, { id: "a2", createdAt: 2 }])
    );
    const client = await connectClient(CREDS);
    const result = (await client.callTool({
      name: "datto_bcdr_list_alerts",
      arguments: {},
    })) as ToolResult;
    const ids = (JSON.parse(text(result)) as Array<{ id: string }>).map((a) => a.id);
    expect(ids).toEqual(["a1", "a2"]);
  });
});

describe("datto_bcdr_list_activity", () => {
  it("filters by timestamp the same way alerts filters by createdAt", async () => {
    mockActivityListAll.mockReturnValue(
      toAsyncIterable([
        { id: "before", timestamp: Math.floor(new Date("2026-01-01T00:00:00Z").getTime() / 1000) },
        { id: "in-window", timestamp: new Date("2026-01-03T00:00:00Z").getTime() },
      ])
    );
    const client = await connectClient(CREDS);
    const result = (await client.callTool({
      name: "datto_bcdr_list_activity",
      arguments: { since: "2026-01-02T00:00:00Z" },
    })) as ToolResult;
    expect(mockActivityListAll).toHaveBeenCalledWith();
    const ids = (JSON.parse(text(result)) as Array<{ id: string }>).map((a) => a.id);
    expect(ids).toEqual(["in-window"]);
  });
});

describe("unknown tool", () => {
  it("returns an isError result naming the unknown tool", async () => {
    const client = await connectClient(CREDS);
    const result = (await client.callTool({
      name: "datto_bcdr_not_a_real_tool",
      arguments: {},
    })) as ToolResult;
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("Unknown tool: datto_bcdr_not_a_real_tool");
  });
});
