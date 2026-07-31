export async function readAiChatStream(
  body: ReadableStream<Uint8Array>,
): Promise<string> {
  let output = "";

  await readAiChatStreamDeltas(body, (delta) => {
    output += delta;
  });

  return output.trim();
}

export async function readAiChatStreamDeltas(
  body: ReadableStream<Uint8Array>,
  onDelta: (delta: string) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const eventChunk of events) {
      emitAiChatEventChunkDeltas(eventChunk, onDelta);
    }
  }

  if (buffer) {
    emitAiChatEventChunkDeltas(buffer, onDelta);
  }
}

function emitAiChatEventChunkDeltas(
  eventChunk: string,
  onDelta: (delta: string) => void,
) {
  for (const line of eventChunk.split("\n")) {
    if (!line.startsWith("data:")) {
      continue;
    }

    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") {
      continue;
    }

    let json: {
      choices?: { delta?: { content?: string } }[];
      error?: string;
    };
    try {
      json = JSON.parse(data) as typeof json;
    } catch {
      // 忽略无法解析的流式片段。
      continue;
    }

    if (json.error) {
      throw new Error(json.error);
    }
    const delta = json.choices?.[0]?.delta?.content;
    if (delta) {
      onDelta(delta);
    }
  }
}
