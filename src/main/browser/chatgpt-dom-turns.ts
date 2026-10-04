/** Shared fixed page helper for GPT Web and ND Translate. DOM nodes stay in-page. */
export const CHATGPT_DOM_TURNS_SCRIPT = `
  const readChatGptDomTurns = () => {
    const nodes = Array.from(document.querySelectorAll('[data-testid^="conversation-turn-"], [data-conversation-transcript] [data-message-role]'));
    // Legacy turns can contain a transcript-role node. Keep the outer turn once.
    const outerNodes = nodes.filter((node) => !nodes.some((other) => other !== node && other.contains?.(node)));
    return outerNodes.flatMap((node) => {
      const messageRole = node.getAttribute('data-message-role');
      const declared = node.getAttribute('data-turn') || node.getAttribute('data-message-author-role') || messageRole;
      const owned = node.querySelector('[data-message-author-role], [data-message-role]');
      const ownedRole = owned?.getAttribute('data-message-author-role') || owned?.getAttribute('data-message-role');
      const role = declared || ownedRole;
      if (role !== 'user' && role !== 'assistant') return [];
      // An explicit turn role owns the turn even if a nested node claims another role.
      const root = owned && (!declared || ownedRole === role) ? owned : node;
      const copy = node.querySelector('button[data-testid="copy-turn-action-button"], button[aria-label="Copy response"]') !== null;
      const transcriptRoot = root.getAttribute('data-message-role') ? root : messageRole ? node : undefined;
      const complete = role === 'assistant' && copy && (!transcriptRoot || transcriptRoot.hasAttribute('data-message-complete'));
      return [{ node, root, role, complete }];
    });
  };
`
