// Fork: the thread details card's way back to a swarm board after its panel tab was closed.
import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { NetworkIcon } from "lucide-react";
import { T, useGT, Var } from "gt-react";
import { useId } from "react";

import { shortcutLabelForCommand } from "~/keybindings";
import { cn } from "~/lib/utils";
import { useRightPanelStore } from "~/rightPanelStore";
import { useAgySwarm } from "~/state/agySwarm";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { ThreadDetailsControl } from "../chat/ThreadDetailsControl";
import { ThreadDetailsSection } from "../chat/ThreadDetailsSection";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
} from "../chat/threadDetailsPanelStyles";
import { Badge } from "../ui/badge";
import { Kbd } from "../ui/kbd";
import { openSwarmSurface } from "./openSwarmSurface";
import { needsInputMembers } from "./swarmBoard.logic";

/** Shown only while the thread coordinates or works in a swarm. */
export function ThreadSwarmSection(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const gt = useGT();
  const headingId = useId();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { swarm } = useAgySwarm(props.environmentId, props.threadId);
  if (swarm === null) return null;
  const threadRef = scopeThreadRef(props.environmentId, props.threadId);
  const live = swarm.members.filter((member) => member.state !== "killed");
  const working = live.filter((member) => member.state === "working").length;
  const waitingInput = needsInputMembers(live).length;
  const shortcut = shortcutLabelForCommand(keybindings, "swarm.toggle");
  const kindBadge =
    swarm.kind === "boost" ? gt("Boost") : swarm.kind === "teamwork" ? gt("Teamwork") : null;
  return (
    <ThreadDetailsSection headingId={headingId} title={gt("Swarm")}>
      <div>
        <ThreadDetailsControl
          onClick={() => {
            openSwarmSurface(threadRef);
            useRightPanelStore.getState().setThreadPanelOpen(threadRef, "popover", false);
          }}
        >
          <NetworkIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />
          <span className={cn(THREAD_DETAILS_PANEL_LABEL_CLASS, "min-w-0 flex-1 truncate")}>
            {swarm.title.trim() === "" ? <T>Swarm board</T> : swarm.title}
          </span>
          {kindBadge ? (
            <Badge variant="secondary" size="sm">
              {kindBadge}
            </Badge>
          ) : null}
          <span
            className={cn(
              "shrink-0 text-xs font-normal tabular-nums",
              waitingInput > 0 ? "text-warning-foreground" : "text-muted-foreground",
            )}
          >
            {waitingInput > 0 ? (
              gt("{count, plural, one {{count} needs input} other {{count} need input}}", {
                count: waitingInput,
              })
            ) : working > 0 ? (
              <T>
                <Var>{working}</Var> working
              </T>
            ) : (
              <>
                <span aria-hidden>{live.length}</span>
                <span className="sr-only">
                  {gt("{count, plural, one {{count} member} other {{count} members}}", {
                    count: live.length,
                  })}
                </span>
              </>
            )}
          </span>
          {shortcut ? <Kbd className="shrink-0">{shortcut}</Kbd> : null}
        </ThreadDetailsControl>
      </div>
    </ThreadDetailsSection>
  );
}
