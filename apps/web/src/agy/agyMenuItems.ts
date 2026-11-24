// Fork: the Antigravity commands as `/` menu entries. They are provider-command-shaped so the
// composer's search, ranking and `/name ` insertion apply unchanged.
import {
  agyMenuCommands,
  agyNativeCommandNames,
} from "@t3tools/client-runtime/agyComposerCommands";
import type { ProviderDriverKind, ServerProvider } from "@t3tools/contracts";

import type { ComposerCommandItem } from "../components/chat/ComposerCommandMenu";
import type { MessageResolver } from "../i18n/messages";

export const AGY_MENU_ITEM_ID_PREFIX = "agy-slash:";

export function agySlashCommandItems(input: {
  readonly provider: ProviderDriverKind;
  readonly providerSlashCommands: ServerProvider["slashCommands"];
  readonly prompt: string;
  readonly rangeStart: number;
  readonly uiAvailable: ReadonlySet<string>;
  readonly resolve: MessageResolver;
}): Array<Extract<ComposerCommandItem, { type: "provider-slash-command" }>> {
  return agyMenuCommands({
    textBeforeTrigger: input.prompt.slice(0, input.rangeStart),
    nativeNames: agyNativeCommandNames(input.providerSlashCommands),
    uiAvailable: input.uiAvailable,
    resolve: input.resolve,
  }).map((command) => ({
    id: `${AGY_MENU_ITEM_ID_PREFIX}${command.name}`,
    type: "provider-slash-command" as const,
    provider: input.provider,
    command: {
      name: command.name,
      description: command.description,
      ...(command.argumentHint === null ? {} : { input: { hint: command.argumentHint } }),
    },
    label: `/${command.name}`,
    description: command.description,
  }));
}
