import { Hash, Menu, PanelRight } from "lucide-react";

import { statusClass, statusLabel } from "./status";
import type { IssueView } from "../../lib/types";

export interface ChannelHeaderProps {
  issue: IssueView | null;
  detailsOpen: boolean;
  onOpenNavigation: () => void;
  onToggleDetails: () => void;
}

export function ChannelHeader({
  issue,
  detailsOpen,
  onOpenNavigation,
  onToggleDetails,
}: ChannelHeaderProps) {
  return (
    <header className="channel-header">
      <button
        className="icon-button mobile-only"
        type="button"
        onClick={onOpenNavigation}
        aria-label="Open navigation"
      >
        <Menu size={19} />
      </button>
      {issue ? (
        <div className="channel-heading">
          <div className="channel-title-line">
            <Hash size={18} aria-hidden="true" />
            <h1>{issue.identifier}</h1>
            <span
              className={statusClass(issue.status)}
              title={statusLabel(issue.status)}
              aria-label={`Status: ${statusLabel(issue.status)}`}
            />
          </div>
          <p>{issue.title}</p>
        </div>
      ) : (
        <div className="channel-heading">
          <h1>Select a channel</h1>
          <p>Choose an issue from the navigation to begin.</p>
        </div>
      )}
      <button
        className="icon-button"
        type="button"
        onClick={onToggleDetails}
        aria-expanded={detailsOpen}
        aria-controls="details-panel"
        aria-label={detailsOpen ? "Hide issue details" : "Show issue details"}
      >
        <PanelRight size={18} />
      </button>
    </header>
  );
}
