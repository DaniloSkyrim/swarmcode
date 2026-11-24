import type { AgySwarmMember, AgySwarmSnapshot, ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { sideThreadOpenIntentOf } from "@t3tools/client-runtime/side-thread";
import { SearchIcon } from "lucide-react";
import { T, useGT } from "gt-react";
import { type ReactNode, useState } from "react";

import { openSideThread } from "~/lib/sideChatPane";
import { cn, isMacPlatform } from "~/lib/utils";
import { buildThreadRouteParams } from "~/threadRoutes";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { Empty, EmptyHeader, EmptyTitle } from "../ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { MEMBER_STATE_TEXT, SwarmAvatar, SwarmStateDot, useMemberStateLabel } from "./SwarmAvatar";
import { SwarmMemberModelControls } from "./SwarmMemberModelControls";
import {
  groupMembers,
  memberBee,
  memberCue,
  memberSnippet,
  type BeeColors,
  type BeeCue,
} from "./swarmBoard.logic";

function MemberRow(props: {
  member: AgySwarmMember;
  bee: BeeColors;
  cue: BeeCue | undefined;
  snippet: string;
  current: boolean;
  threadRef: ScopedThreadRef;
  onOpen: (member: AgySwarmMember, intent: "primary" | "alternate") => void;
}) {
  const stateLabel = useMemberStateLabel();
  const { member } = props;
  const live = member.state !== "killed";
  const model = live ? null : member.model;
  const controls = live ? (
    <div className="ps-12 pe-2 pb-1">
      <SwarmMemberModelControls
        threadRef={props.threadRef}
        memberName={member.name}
        fallbackModel={member.model}
      />
    </div>
  ) : null;
  const content = (
    <>
      <SwarmAvatar bee={props.bee} cue={props.cue} working={member.state === "working"} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2 text-sm">
          <span className="min-w-0 truncate font-medium text-foreground">{member.name}</span>
          <span
            className={cn(
              "flex shrink-0 items-center gap-1 text-xs",
              MEMBER_STATE_TEXT[member.state],
            )}
          >
            <SwarmStateDot state={member.state} />
            {stateLabel(member.state)}
          </span>
          {props.current ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              <T>This thread</T>
            </span>
          ) : null}
          {member.lastPostSeq === null ? null : (
            <span className="ms-auto shrink-0 ps-2 font-mono text-xs tabular-nums text-muted-foreground/80">
              #{member.lastPostSeq}
            </span>
          )}
        </span>
        {model || props.snippet ? (
          <span className="flex min-w-0 items-baseline gap-1.5 text-xs text-muted-foreground">
            {model ? (
              <span className="max-w-[45%] shrink-0 truncate font-mono">{model}</span>
            ) : null}
            {model && props.snippet ? <span aria-hidden>·</span> : null}
            {props.snippet ? <span className="min-w-0 truncate">{props.snippet}</span> : null}
          </span>
        ) : null}
      </span>
    </>
  );
  const rowClass = cn(
    "flex w-full min-w-0 items-start gap-3 rounded-md px-2 py-2 text-left",
    member.state === "killed" && "opacity-70",
  );
  if (props.current) {
    return (
      <li className="px-2" aria-current="true">
        <div className={rowClass}>{content}</div>
        {controls}
      </li>
    );
  }
  return (
    <li className="px-2">
      <button
        type="button"
        className={cn(
          rowClass,
          "cursor-pointer hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        )}
        onClick={(event) =>
          props.onOpen(member, sideThreadOpenIntentOf(event, isMacPlatform(navigator.platform)))
        }
        onAuxClick={(event) => {
          if (event.button === 1) props.onOpen(member, "alternate");
        }}
      >
        {content}
      </button>
      {controls}
    </li>
  );
}

function MemberSection(props: { label: ReactNode; count: number; children: ReactNode }) {
  return (
    <section className="flex flex-col">
      <h3 className="flex items-center gap-1.5 px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground">
        {props.label}
        <span className="tabular-nums text-muted-foreground/70">{props.count}</span>
      </h3>
      <ul className="flex flex-col">{props.children}</ul>
    </section>
  );
}

export function SwarmMembers(props: { swarm: AgySwarmSnapshot; threadRef: ScopedThreadRef }) {
  const gt = useGT();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [retiredOpen, setRetiredOpen] = useState(false);
  // Only joins and posts that land while this tab is open animate a bee.
  const [opened] = useState(() => ({
    seq: props.swarm.head,
    names: new Set(props.swarm.members.map((member) => member.name)),
  }));
  const groups = groupMembers(props.swarm.members, query);
  const openMember = (member: AgySwarmMember, intent: "primary" | "alternate") =>
    openSideThread({
      threadRef: scopeThreadRef(props.threadRef.environmentId, member.threadId),
      panelRef: props.threadRef,
      intent,
      navigate: (target) =>
        void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(target) }),
    });
  const row = (member: AgySwarmMember) => (
    <MemberRow
      key={member.name}
      member={member}
      bee={memberBee(props.swarm.members, member.name)}
      cue={memberCue(member, props.swarm.posts, opened)}
      snippet={memberSnippet(member, props.swarm.posts)}
      current={member.threadId === props.threadRef.threadId}
      threadRef={scopeThreadRef(props.threadRef.environmentId, member.threadId)}
      onOpen={openMember}
    />
  );
  const empty =
    groups.coordinators.length +
      groups.active.length +
      groups.standingBy.length +
      groups.retired.length ===
    0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-4 pt-3 pb-1">
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            value={query}
            placeholder={gt("Search members")}
            aria-label={gt("Search members")}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape" || !event.currentTarget.value) return;
              event.stopPropagation();
              setQuery("");
            }}
          />
        </InputGroup>
      </div>
      {empty ? (
        <Empty size="compact">
          <EmptyHeader>
            <EmptyTitle>
              <T>No matching members</T>
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3">
          {groups.coordinators.length > 0 ? (
            <ul className="flex flex-col pt-2">{groups.coordinators.map(row)}</ul>
          ) : null}
          {groups.active.length > 0 ? (
            <MemberSection label={<T>Active</T>} count={groups.active.length}>
              {groups.active.map(row)}
            </MemberSection>
          ) : null}
          {groups.standingBy.length > 0 ? (
            <MemberSection label={<T>Standing by</T>} count={groups.standingBy.length}>
              {groups.standingBy.map(row)}
            </MemberSection>
          ) : null}
          {groups.retired.length > 0 ? (
            <section className="flex flex-col px-2 pt-2">
              <CollapsibleSectionHeader
                variant="panel"
                expanded={retiredOpen || query.trim() !== ""}
                onClick={() => setRetiredOpen((open) => !open)}
                accessory={
                  <span className="text-xs tabular-nums text-muted-foreground/70">
                    {groups.retired.length}
                  </span>
                }
              >
                <T>Retired</T>
              </CollapsibleSectionHeader>
              {retiredOpen || query.trim() !== "" ? (
                <ul className="-mx-2 flex flex-col">{groups.retired.map(row)}</ul>
              ) : null}
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
