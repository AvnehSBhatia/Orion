"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ArrowUpIcon, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { forwardRef, useCallback, useEffect, useId, useRef, useState } from "react";

interface AutoResizeProps {
  minHeight: number;
  maxHeight?: number;
}

function useAutoResizeTextarea({ minHeight, maxHeight }: AutoResizeProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(
    (reset?: boolean) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      if (reset) {
        textarea.style.height = `${minHeight}px`;
        return;
      }

      textarea.style.height = `${minHeight}px`;
      const newHeight = Math.max(minHeight, Math.min(textarea.scrollHeight, maxHeight ?? Infinity));
      textarea.style.height = `${newHeight}px`;
    },
    [minHeight, maxHeight],
  );

  useEffect(() => {
    if (textareaRef.current) textareaRef.current.style.height = `${minHeight}px`;
  }, [minHeight]);

  return { textareaRef, adjustHeight };
}

export type QuickActionItem = { icon: LucideIcon; label: string; prompt: string };

export interface MoonChatInputProps {
  onSend: (message: string) => void;
  /** Called on every edit with the change in character count. Positive when typing, negative when deleting. */
  onType?: (delta: number) => void;
  placeholder?: string;
  actions?: QuickActionItem[];
  autoFocus?: boolean;
  className?: string;
}

const RuixenMoonChat = forwardRef<HTMLTextAreaElement, MoonChatInputProps>(function RuixenMoonChat(
  { onSend, onType, placeholder = "Ask what your team is working on", actions, autoFocus, className },
  ref,
) {
  const id = useId();
  const [message, setMessage] = useState("");
  const { textareaRef, adjustHeight } = useAutoResizeTextarea({
    minHeight: 64,
    maxHeight: 160,
  });
  const hasContent = message.trim() !== "";

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus({ preventScroll: true });
  }, [autoFocus, textareaRef]);

  const submit = () => {
    if (!hasContent) return;
    onSend(message.trim());
    setMessage("");
    adjustHeight(true);
  };

  return (
    <div className={cn("w-full", className)}>
      <div className="relative rounded-xl border border-neutral-700 bg-black/60 backdrop-blur-md">
        <label htmlFor={id} className="sr-only">
          Ask about your work
        </label>
        <Textarea
          id={id}
          ref={(element) => {
            textareaRef.current = element;
            if (typeof ref === "function") ref(element);
            else if (ref) ref.current = element;
          }}
          value={message}
          onChange={(event) => {
            onType?.(event.target.value.length - message.length);
            setMessage(event.target.value);
            adjustHeight();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          className={cn(
            "w-full resize-none border-none px-4 py-3",
            "bg-transparent text-[15px] text-white",
            "focus-visible:ring-0 focus-visible:ring-offset-0",
            "min-h-[64px] placeholder:text-neutral-500",
          )}
          style={{ overflow: "hidden" }}
        />

        <div className="flex items-center justify-between p-3 pt-1">
          <span className="pl-1 text-[13px] text-neutral-500">Enter to send</span>
          <Button
            type="button"
            onClick={submit}
            disabled={!hasContent}
            aria-label="Send"
            className={cn(
              "flex h-9 items-center gap-1 rounded-lg px-3 py-2 transition-colors disabled:opacity-100",
              hasContent ? "bg-white text-black hover:bg-neutral-200" : "bg-neutral-800 text-neutral-500",
            )}
          >
            <ArrowUpIcon className="h-4 w-4" />
            <span className="sr-only">Send</span>
          </Button>
        </div>
      </div>

      {actions && actions.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {actions.map((action, index) => (
            <motion.div
              key={action.label}
              initial={{ opacity: 0, y: 8, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ duration: 0.5, delay: 0.9 + index * 0.06, ease: [0.22, 1, 0.36, 1] }}
            >
              <QuickAction icon={action.icon} label={action.label} onClick={() => onSend(action.prompt)} />
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
});

export default RuixenMoonChat;

function QuickAction({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      className="flex h-9 items-center gap-2 rounded-full border-neutral-700 bg-black/50 text-neutral-300 backdrop-blur-sm hover:bg-neutral-800 hover:text-white"
    >
      <Icon className="h-4 w-4" />
      <span className="text-xs">{label}</span>
    </Button>
  );
}
