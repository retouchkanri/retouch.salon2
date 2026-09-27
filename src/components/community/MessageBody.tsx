"use client";

import { Fragment, memo, useMemo } from "react";
import { isJumboEmoji } from "@/lib/emoji";
import { parseMessageBody, type Inline } from "@/lib/community/text";
import { EmojiText } from "./Emoji";
import { useCS, useName } from "./store";

function Mention({ userId }: { userId: string }) {
  const name = useName(userId);
  const mine = useCS((s) => s.me.id === userId);
  return (
    <span
      className={`rounded-[3px] px-[2px] ${
        mine ? "bg-[#F2C74466] text-sk-text" : "bg-[#1D9BD11A] text-sk-link hover:bg-[#1D9BD133]"
      }`}
    >
      @{name}
    </span>
  );
}

function InlineNode({ node, emojiSize }: { node: Inline; emojiSize: number }) {
  switch (node.type) {
    case "text":
      return <EmojiText text={node.text} size={emojiSize} />;
    case "br":
      return <br />;
    case "bold":
      return (
        <strong className="font-bold">
          <EmojiText text={node.text} size={emojiSize} />
        </strong>
      );
    case "italic":
      return (
        <em className="italic">
          <EmojiText text={node.text} size={emojiSize} />
        </em>
      );
    case "strike":
      return (
        <s>
          <EmojiText text={node.text} size={emojiSize} />
        </s>
      );
    case "code":
      return (
        <code className="rounded-[3px] border border-[#1D1C1D21] bg-[#1D1C1D0A] px-[3px] py-[1px] font-mono text-[12px] text-[#E01E5A]">
          {node.text}
        </code>
      );
    case "link":
      return (
        <a
          href={node.href}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
          className="text-sk-link hover:underline break-all"
        >
          {node.text}
        </a>
      );
    case "mention":
      return <Mention userId={node.userId} />;
    case "channel":
      return <span className="rounded-[3px] px-[2px] bg-[#F2C74466] text-sk-text">@channel</span>;
    default:
      return null;
  }
}

function Inlines({ nodes, emojiSize }: { nodes: Inline[]; emojiSize: number }) {
  return (
    <>
      {nodes.map((n, j) => (
        <Fragment key={j}>
          <InlineNode node={n} emojiSize={emojiSize} />
        </Fragment>
      ))}
    </>
  );
}

/** メッセージ本文（Slack と同じ書式）。HTML は解釈せず React のテキストとして描画する。 */
function MessageBodyInner({ body }: { body: string }) {
  const blocks = useMemo(() => parseMessageBody(body), [body]);
  const jumbo = useMemo(() => isJumboEmoji(body), [body]);
  const emojiSize = jumbo ? 32 : 22;
  return (
    <div className="text-[15px] leading-[1.46668] text-sk-text break-words [overflow-wrap:anywhere] whitespace-pre-wrap">
      {blocks.map((b, i) => {
        if (b.type === "code") {
          return (
            <pre
              key={i}
              className="my-1 rounded-[4px] border border-[#1D1C1D21] bg-[#1D1C1D0A] p-2 font-mono text-[12px] leading-[1.5] overflow-x-auto whitespace-pre"
            >
              <code>{b.text}</code>
            </pre>
          );
        }
        if (b.type === "quote") {
          return (
            <blockquote key={i} className="my-0.5 border-l-4 border-[#DDDDDD] pl-3 text-sk-text">
              <Inlines nodes={b.inlines} emojiSize={emojiSize} />
            </blockquote>
          );
        }
        if (b.type === "list") {
          const Tag = b.ordered ? "ol" : "ul";
          return (
            <Tag
              key={i}
              start={b.ordered ? b.start : undefined}
              className={`my-0.5 pl-6 ${b.ordered ? "list-decimal" : "list-disc"} whitespace-normal`}
            >
              {b.items.map((item, j) => (
                <li key={j} className="pl-0.5">
                  <Inlines nodes={item} emojiSize={emojiSize} />
                </li>
              ))}
            </Tag>
          );
        }
        return (
          <p key={i} className="m-0">
            <Inlines nodes={b.inlines} emojiSize={emojiSize} />
          </p>
        );
      })}
    </div>
  );
}

const MessageBody = memo(MessageBodyInner);
export default MessageBody;
