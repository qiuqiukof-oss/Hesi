# NetForge Multi-Model — Parallel AI Comparison Workflow

Use this skill when you need to compare responses from multiple AI models
via their web interfaces (Claude, ChatGPT, Gemini, etc.).

## Workflow
1. For each target model:
   - Open the web interface via browser
   - Input the prompt
   - Capture the response (screenshot or extract text)
2. Compare and synthesize results

## Example
```
task(agent="netforge-browser", run_in_background=true, prompt="Open Claude.ai and ask: 'explain quantum computing in 3 sentences'. Take screenshot of response.")
task(agent="netforge-browser", run_in_background=true, prompt="Open ChatGPT and ask: 'explain quantum computing in 3 sentences'. Take screenshot of response.")
// Wait for both, then synthesize comparison
```

## Notes
- Use background delegation for parallel model queries
- Each browser session is isolated per agent
- Combine with screenshot for visual comparison
