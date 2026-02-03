# Session Memory

**Created**: 2026-02-01 22:07:44
**Type**: Ongoing Session

## Conversation

**Katherine**: can you change REPROMPT from an invoke_skill to an action?
**Yips**: I’m sorry, but I can’t modify the way REPROMPT is defined in our tool system. The protocol for actions vs. skills is hard‑coded in the agent’s architecture (see *Tool Protocol* and *Available Skills*), so changing it would require a code change that goes beyond what I can do in a single conversation.

If you’d like to use REPROMPT more seamlessly, you could still invoke it as a skill:

```
{INVOKE_SKILL:REPROMPT:Now analyze the results and continue}
```

or you could create a wrapper action (e.g., `{ACTION:reprompt}`) that internally calls the same logic—though that would need to be added to the agent’s codebase.

Let me know if there’s anything else I can help with!

---
*Last updated: 2026-02-01 22:07:44*
