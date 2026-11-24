// Fork: the Antigravity prompt commands for the mobile `/` menu. UI commands are web-only for now,
// and commands do not stack here because the menu builder sees only the text of the trigger.
import {
  agyMenuCommands,
  agyNativeCommandNames,
} from "@t3tools/client-runtime/agyComposerCommands";
import type { ServerProvider } from "@t3tools/contracts";

import type { MessageResolver } from "../../i18n/messages";
import type { ComposerCommandItem } from "./ComposerCommandPopover";

const NO_UI_COMMANDS: ReadonlySet<string> = new Set();

export function agySlashCommandItems(input: {
  readonly query: string;
  readonly providerSlashCommands: ServerProvider["slashCommands"];
  readonly resolve: MessageResolver;
}): ComposerCommandItem[] {
  const query = input.query.toLowerCase();
  return agyMenuCommands({
    textBeforeTrigger: "",
    nativeNames: agyNativeCommandNames(input.providerSlashCommands),
    uiAvailable: NO_UI_COMMANDS,
    resolve: input.resolve,
  })
    .filter((command) => command.name.includes(query))
    .map((command) => ({
      id: `agycmd:${command.name}`,
      type: "provider-slash-command" as const,
      command: {
        name: command.name,
        description: command.description,
        ...(command.argumentHint === null ? {} : { input: { hint: command.argumentHint } }),
      },
      label: `/${command.name}`,
      description: command.description,
    }));
}
