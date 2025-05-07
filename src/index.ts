#!/usr/bin/env node

import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import tigerFactory, {TigerTokenAuthProvider} from "@gooddata/sdk-backend-tiger";
import {ITigerClient} from "@gooddata/api-client-tiger";
import {PDFiumDocument, PDFiumLibrary} from "@hyzyla/pdfium";
import {config} from "dotenv";
import sharp from "sharp";
import {z} from "zod";

config();

const MAX_POLL_ATTEMPTS = 10;
const DEFAULT_POLL_DELAY = 3000;
const HOST = process.env.GOODDATA_HOST;
const TOKEN = process.env.GOODDATA_TOKEN;
const WORKSPACE = process.env.GOODDATA_WORKSPACE;
const NOTIFICATION_CHANNEL = process.env.GOODDATA_NOTIFICATION_CHANNEL;

if (!HOST || !TOKEN || !WORKSPACE || !NOTIFICATION_CHANNEL) {
    throw new Error("Please provide GOODDATA_HOST, GOODDATA_TOKEN, GOODDATA_WORKSPACE and NOTIFICATION_CHANNEL environment variables");
}

const backend = tigerFactory().onHostname(HOST).withAuthentication(
    new TigerTokenAuthProvider(TOKEN),
);
const workspace = backend.workspace(WORKSPACE);
// @ts-ignore
const client: ITigerClient = backend.decorated.client as ITigerClient;

// Create an MCP server
const server = new McpServer({
    name: "GoodData",
    version: "1.0.0",
});

// Add a semantic search resource
// server.tool(
//     "dashboard_search",
//     "Find relevant dashboards by search term",
//     {search_term: z.string()},
//     async ({search_term}) => {
//         const searchResults = await workspace.genAI()
//             .getSemanticSearchQuery()
//             .withQuestion(search_term)
//             .withDeepSearch(true)
//             .withObjectTypes(["dashboard"])
//             .query();
//
//         const textResults = searchResults.results.map(result => {
//             return `type: ${result.type}; title: ${result.title}; id: ${result.id};`;
//         });
//
//         return {
//             content: [{type: "text", text: textResults.join("\n")}],
//         };
//     },
// );

server.tool(
    "visualization_search",
    "Find relevant visualizations by search term",
    {search_term: z.string()},
    async ({search_term}) => {
        const searchResults = await workspace.genAI()
            .getSemanticSearchQuery()
            .withQuestion(search_term)
            .withDeepSearch(true)
            .withObjectTypes(["visualization"])
            .query();

        const textResults = searchResults.results.map(result => {
            return `type: ${result.type}; title: ${result.title}; id: ${result.id};`;
        });

        return {
            content: [{type: "text", text: textResults.join("\n")}],
        };
    },
);

// server.tool(
//     "dashboard_png_export",
//     "Export a dashboard to image",
//     {dashboardId: z.string()},
//     async ({dashboardId}) => {
//         const exportResult = await workspace.dashboards().exportDashboardToPdf(idRef(dashboardId));
//         const fullUrl = new URL(exportResult.uri, process.env.GOODDATA_HOST).href;
//         const dashboardBlobRequest = await fetch(fullUrl, {
//             headers: {
//                 Authorization: `Bearer ${process.env.GOODDATA_TOKEN}`,
//             },
//         });
//         const dashboard = await dashboardBlobRequest.arrayBuffer();
//         const images = await pdfToPng(new Uint8Array(dashboard));
//
//         return {
//             content: images.map(image => ({
//                 type: "image",
//                 data: Buffer.from(image).toString("base64"),
//                 mimeType: "image/png",
//             })),
//         };
//     },
// );

server.tool(
    "visualization_png_export",
    "Export a visualization to image",
    {visualizationId: z.string()},
    async ({visualizationId}) => {
        const {data: {exportResult}} = await client.export.createSlidesExport({
            workspaceId: workspace.workspace,
            slidesExportRequest: {
                format: "PDF",
                fileName: "export.pdf",
                // @ts-ignore
                visualizationIds: [visualizationId],
            },
        });

        let data: null | Uint8Array = null;
        for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
            const result = await client.export.getSlidesExport({
                workspaceId: process.env.GOODDATA_WORKSPACE!,
                exportId: exportResult,
            }, {
                transformResponse: (x) => x,
                responseType: "arraybuffer",
            });

            if (result?.status === 200) {
                // @ts-ignore
                data = result?.data;
                break;
            }

            await new Promise((resolve) => setTimeout(resolve, DEFAULT_POLL_DELAY));
        }

        if (!data) {
            return {
                isError: true,
                content: [{type: "text", text: "Export failed"}],
            };
        }

        const images = await pdfToPng(data);

        return {
            content: images.map(image => ({
                type: "image",
                data: Buffer.from(image).toString("base64"),
                mimeType: "image/png",
            })),
        };
    },
);

server.tool(
    "visualization_schedule",
    "Schedule a visualization export over email.\n" +
    "Cron format must be: SECOND MINUTE HOUR DAY-OF-MONTH MONTH DAY-OF-WEEK\n" +
    "For example, every Monday at 9am would be: 0 0 9 * * MON",
    {
        visualizationId: z.string(),
        email: z.string(),
        cron: z.string({
            description: "Cron in format 0 0 9 * * MON",
        }),
    },
    async ({visualizationId, email, cron}) => {
        const automationId = `automation-${Date.now()}`;
        const automationsResponse = await client.axios.post(`/api/v1/entities/workspaces/${workspace.workspace}/automations`, {
            data: {
                type: "automation",
                id: automationId,
                attributes: {
                    title: "My automation",
                    description: "My automation description",
                    tags: [],
                    state: "ACTIVE",
                    schedule: {
                        cron,
                        timezone: "UTC",
                    },
                    tabularExports: [
                        {
                            requestPayload: {
                                format: "PDF",
                                fileName: "MyExport.pdf",
                                visualizationObject: visualizationId,
                            },
                        },
                    ],
                    externalRecipients: [
                        {
                            email,
                        },
                    ],
                },
                relationships: {
                    notificationChannel: {
                        data: {
                            type: "notificationChannel",
                            id: NOTIFICATION_CHANNEL,
                        },
                    },
                },
            },
        }, {
            headers: {
                "Content-Type": "application/vnd.gooddata.api+json",
            },
        });

        if (automationsResponse.status >= 400) {
            return {
                isError: true,
                content: [{type: "text", text: "Automation creation failed: " + automationsResponse.data}],
            };
        }

        const triggerResponse = await client.axios.post(`/api/v1/actions/workspaces/${workspace.workspace}/automations/${automationId}/trigger`);

        if (triggerResponse.status >= 400) {
            return {
                isError: true,
                content: [{
                    type: "text",
                    text: "Automation was scheduled, but the test trigger failed: " + triggerResponse.data,
                }],
            };
        }

        return {
            content: [{type: "text", text: `Export scheduled`}],
        };
    },
);

const pdfToPng = async (pdf: Uint8Array<ArrayBufferLike>): Promise<Uint8Array<ArrayBufferLike>[]> => {
    let library: PDFiumLibrary | null = null;
    let document: PDFiumDocument | null = null;
    try {
        library = await PDFiumLibrary.init();

        document = await library.loadDocument(pdf);

        const images: Uint8Array<ArrayBufferLike>[] = [];
        for (const page of document.pages()) {
            const imageData = await page.render({
                scale: 3,
                render: (options) =>
                    sharp(options.data, {
                        raw: {
                            width: options.width,
                            height: options.height,
                            channels: 4,
                        },
                    }).png().toBuffer(),
            });
            images.push(imageData.data);
        }

        return images;
    } catch (e) {
        return Promise.reject(e);
    } finally {
        if (document) {
            document.destroy();
        }
        if (library) {
            library.destroy();
        }
    }
};

// Start receiving messages on stdin and sending messages on stdout
const transport = new StdioServerTransport();
await server.connect(transport);
