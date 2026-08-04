import { Send, AlertCircle } from "lucide-react";
import type { FormEvent, KeyboardEvent } from "react";

export interface MessageComposerProps {
  issueIdentifier: string;
  value: string;
  pending: boolean;
  error: unknown;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Message failed to send. Your draft is preserved; try again.";
}

export function MessageComposer({
  issueIdentifier,
  value,
  pending,
  error,
  onChange,
  onSubmit,
}: MessageComposerProps) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <form className="composer" onSubmit={submit}>
      <label htmlFor="message-input" className="sr-only">
        Message {issueIdentifier}
      </label>
      <textarea
        id="message-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={`Message ${issueIdentifier}`}
        disabled={pending}
        rows={3}
      />
      <div className="composer-footer">
        <span>Enter to send · Shift+Enter for a new line</span>
        <button
          className="send-button"
          type="submit"
          disabled={pending || !value.trim()}
        >
          {pending ? "Sending…" : <><Send size={16} aria-hidden="true" />Send</>}
        </button>
      </div>
      {error ? (
        <div className="composer-error" role="alert">
          <AlertCircle size={15} aria-hidden="true" />
          {errorText(error)}
        </div>
      ) : null}
    </form>
  );
}
