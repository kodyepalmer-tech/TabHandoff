/**
 * Injected via chrome.scripting.executeScript when the content script is not present
 * (any http(s) page, including the local AI-chat fixture).
 * Captures the full conversation thread around a prompt when message nodes are found.
 */
(function tabhandoffCaptureInject() {
  const MAX_THREAD = 200_000;
  const MAX_TURN = 40_000;

  function detectSite(hostname) {
    const h = String(hostname || "").toLowerCase();
    if (h === "chatgpt.com" || h === "chat.openai.com" || h.endsWith(".chatgpt.com")) {
      return "chatgpt";
    }
    if (h === "claude.ai" || h.endsWith(".claude.ai")) return "claude";
    if (
      h === "cursor.com" ||
      h.endsWith(".cursor.com") ||
      h === "cursor.sh" ||
      h.endsWith(".cursor.sh")
    ) {
      return "cursor";
    }
    if (document.querySelector("[data-tabhandoff-fixture='ai-chat']")) {
      return (
        document
          .querySelector("[data-tabhandoff-fixture='ai-chat']")
          ?.getAttribute("data-site") || "fixture"
      );
    }
    return "unknown";
  }

  const SITE = detectSite(location.hostname);
  const MESSAGE_SELECTORS = {
    chatgpt: [
      "[data-message-author-role]",
      "[data-testid^='conversation-turn']",
      "article[data-testid]",
    ],
    claude: [
      "[data-test-render-count]",
      "[class*='font-claude-message']",
      "[data-is-streaming]",
    ],
    cursor: ["[data-message-id]", "[class*='composer']", "[class*='message']", "article"],
    fixture: ["[data-message-role]", "[data-message]", "article.message"],
    unknown: [
      "[data-message-author-role]",
      "[data-message-role]",
      "[role='article']",
      "[class*='message']",
      "article",
    ],
  };

  function messageSelectorList() {
    return [...(MESSAGE_SELECTORS[SITE] || []), ...MESSAGE_SELECTORS.unknown];
  }

  function nearestMessageRoot(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) {
      node = node?.parentElement || null;
    }
    const selectors = messageSelectorList();
    let el = node;
    while (el && el !== document.body) {
      for (const sel of selectors) {
        try {
          if (el.matches?.(sel)) return el;
        } catch {
          /* skip */
        }
      }
      el = el.parentElement;
    }
    return null;
  }

  function textFrom(el) {
    if (!el) return "";
    const clone = el.cloneNode(true);
    clone.querySelectorAll?.(".role, [data-role-label], [data-tabhandoff]").forEach((n) => n.remove());
    return (clone.innerText || clone.textContent || "").replace(/\s+\n/g, "\n").trim();
  }

  function roleFrom(el) {
    if (!el) return "unknown";
    const attr =
      el.getAttribute("data-message-author-role") ||
      el.getAttribute("data-message-role") ||
      el.getAttribute("data-role") ||
      "";
    if (attr) return String(attr).toLowerCase();
    const roleEl = el.querySelector?.(".role, [data-role-label]");
    const roleText = (roleEl?.textContent || "").toLowerCase();
    if (roleText.includes("you") || roleText.includes("user") || roleText.includes("human")) {
      return "user";
    }
    if (
      roleText.includes("assistant") ||
      roleText.includes("claude") ||
      roleText.includes("chatgpt")
    ) {
      return "assistant";
    }
    return "unknown";
  }

  function collectMessageElements() {
    const seen = new Set();
    const out = [];
    for (const sel of messageSelectorList()) {
      let nodes;
      try {
        nodes = document.querySelectorAll(sel);
      } catch {
        continue;
      }
      for (const el of nodes) {
        if (seen.has(el)) continue;
        let ancestorIsMessage = false;
        for (const other of seen) {
          if (other.contains(el) && other !== el) {
            ancestorIsMessage = true;
            break;
          }
        }
        if (ancestorIsMessage) continue;
        for (const other of [...seen]) {
          if (el.contains(other) && other !== el) {
            seen.delete(other);
            const idx = out.indexOf(other);
            if (idx >= 0) out.splice(idx, 1);
          }
        }
        seen.add(el);
        out.push(el);
      }
    }
    return out.sort((a, b) => {
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
  }

  function turnsFromElements(els) {
    const turns = [];
    for (const el of els) {
      const text = textFrom(el).slice(0, MAX_TURN);
      if (!text) continue;
      turns.push({ role: roleFrom(el), text });
    }
    return turns;
  }

  function formatThread(turns) {
    if (!turns.length) return "";
    return turns
      .map((t, i) => {
        const label =
          t.role === "user"
            ? "User"
            : t.role === "assistant"
              ? "Assistant"
              : `Turn ${i + 1}`;
        return `### ${label}\n\n${t.text}`;
      })
      .join("\n\n---\n\n")
      .slice(0, MAX_THREAD);
  }

  const selection = window.getSelection();
  const selectedText = (selection?.toString() || "").trim();
  let anchor = null;
  if (selection && selection.rangeCount > 0) {
    anchor = selection.getRangeAt(0).commonAncestorContainer;
  }
  const messageEls = collectMessageElements();
  const focusEl = nearestMessageRoot(anchor);
  const focusMessageText = textFrom(focusEl).slice(0, MAX_TURN);
  const turns = turnsFromElements(messageEls);
  const threadText = formatThread(turns);

  let captureMode = "selection";
  let fragileNote =
    "Selection only — could not identify a chat thread (AI site DOM is fragile).";

  if (turns.length >= 2 && threadText) {
    captureMode = selectedText
      ? "selection_with_thread"
      : focusMessageText
        ? "message_with_thread"
        : "thread";
    fragileNote = `Captured ${turns.length} conversation turns via best-effort DOM so another AI can continue without missing prior context. Site redesigns can break this — always review the package.`;
  } else if (focusEl && focusMessageText) {
    captureMode = selectedText ? "selection_in_message" : "message";
    fragileNote =
      "Captured nearest chat message but not a multi-turn thread. DOM may have changed; review before handing off.";
  } else if (selectedText) {
    captureMode = "selection";
  } else if (turns.length === 1) {
    captureMode = "last_message_fallback";
    fragileNote =
      "No selection — used a single matching message as a fragile fallback. Prefer highlighting the prompt.";
  }

  const payloadText = (threadText || focusMessageText || selectedText || "").trim();

  return {
    ok: Boolean(payloadText),
    siteId: SITE,
    host: location.hostname,
    url: location.href,
    title: document.title || "",
    selectedText: selectedText || undefined,
    focusMessageText: focusMessageText || undefined,
    messageText: focusMessageText || selectedText || undefined,
    threadText: threadText || undefined,
    turns: turns.length
      ? turns.map((t) => ({ role: t.role, text: t.text.slice(0, MAX_TURN) }))
      : undefined,
    turnCount: turns.length,
    captureMode,
    fragile: true,
    fragileNote,
    pageText: (document.body?.innerText || "")
      .replace(/\s+\n/g, "\n")
      .trim()
      .slice(0, 20_000),
  };
})();
