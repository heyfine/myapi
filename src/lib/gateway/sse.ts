// SSE 流式转换通用工具：字节流进、字节流出，内部按行解析 SSE data 事件

export interface SSEConverterOptions {
  /** 每解析到一个 data 事件调用一次；通过 ctx.emit 发出 OpenAI chunk */
  onEvent: (payload: string, ctx: { emit: (chunk: unknown) => void }) => void;
  /** 上游流结束时调用，用于发出尾部 usage/[DONE] chunk */
  onEnd: (ctx: { emit: (chunk: unknown) => void }) => void;
}

export function convertSSE(upstream: ReadableStream<Uint8Array>, opts: SSEConverterOptions): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let buf = "";

  function emit(controller: TransformStreamDefaultController<Uint8Array>, chunk: unknown) {
    controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
  }

  return upstream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buf += decoder.decode(chunk, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith("data:")) continue;
          const payload = t.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          opts.onEvent(payload, { emit: (c) => emit(controller, c) });
        }
      },
      flush(controller) {
        opts.onEnd({ emit: (c) => emit(controller, c) });
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      },
    }),
  );
}
