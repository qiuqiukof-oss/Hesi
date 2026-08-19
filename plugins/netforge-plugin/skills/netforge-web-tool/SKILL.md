# NetForge Web Tool — Browser Interaction Workflow

Use this skill when you need to interact with a web page using the browser.
Covers navigation, screenshot, click, type, evaluate JS, and multi-step page workflows.

## Setup
The browser MCP server (`netforge_browser`) provides these tools directly:
- `browser_navigate`
- `browser_screenshot`
- `browser_click`
- `browser_type`
- `browser_evaluate`
- `browser_close`

## Basic Workflow
1. Navigate: `browser_navigate({ url: "..." })`
2. Wait for page to render (use `browser_screenshot` to verify)
3. Interact: `browser_click`, `browser_type`
4. Extract: `browser_screenshot` or `browser_evaluate` to get page data
5. Close: `browser_close` when done

## Common Patterns

### Fetch rendered page content
```
browser_navigate({ url: "https://example.com" })
// Wait briefly
const screenshot = browser_screenshot()
const text = browser_evaluate({ expression: "document.body.innerText" })
```

### Fill and submit a form
```
browser_navigate({ url: "https://example.com/login" })
browser_type({ selector: "#username", text: "user" })
browser_type({ selector: "#password", text: "pass" })
browser_click({ selector: "button[type=submit]" })
```

### Multi-step page workflow
Chain navigate → interact → extract → close.

## Deligation
For complex workflows, delegate to the browser agent:
`task(agent="netforge-browser", prompt="...")`
