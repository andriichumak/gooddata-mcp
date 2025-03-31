# A PoC for GoodData MCP Server

Supported functionality:
* Semantic search for visualizations.
* Generation of PNG images for visualizations.
* Scheduling email reports for visualizations data.

## Installation

Make sure you have a reasonably fresh NodeJS installed.

For Claude Desktop, configure the following integration:

```json
{
    "mcpServers": {
        "gooddata": {
            "command": "npx",
            "args": [
                "-y andriichumak/gooddata-mcp"
            ],
            "env": {
                "GOODDATA_TOKEN": "****",
                "GOODDATA_HOST": "https://****.gooddata.com",
                "GOODDATA_WORKSPACE": "****",
                "GOODDATA_NOTIFICATION_CHANNEL": "****"
            }
        }
    }
}
```

* TOKEN - GoodData API token.
* HOST - GoodData server host for your org.
* WORKSPACE - GoodData workspace ID.
* NOTIFICATION_CHANNEL - GoodData notification channel ID for email reports.
