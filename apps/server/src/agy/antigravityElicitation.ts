import { type OrchestrationV2UserInputQuestion, TrimmedNonEmptyString } from "@t3tools/contracts";
import type { AcpAdapterV2Flavor } from "@t3tools/provider-acp/server/adapter";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import type * as EffectAcpSchema from "effect-acp/compat";

const HEADER_LIMIT = 120;
const OPTION_LABEL_LIMIT = 512;
const QUESTION_TEXT_LIMIT = 8_000;
const SHORT_SEPARATOR_LABEL_LIMIT = 80;
const QUESTION_ID_PATTERN = /^q(?:0|[1-9]\d*)$/;
const COMPANION_SUFFIX = "_other";

export const ANTIGRAVITY_ASK_QUESTION_INSTRUCTIONS = `<ask_question_formatting>
When calling \`ask_question\`, format each option as \`Short label: brief description explaining what it does or its trade-off\`. Use \`: \` to separate the concise label from the description.
</ask_question_formatting>`;

export const ANTIGRAVITY_ORTHOGRAPHY_INSTRUCTIONS = `<response_orthography>
When replying in a non-English language (such as Portuguese, Spanish, French, or German), always use proper native orthography, diacritics, and punctuation (e.g., \`á, é, í, ó, ú, â, ê, ô, ã, õ, ç\`, \`não\`, \`função\`, \`também\`). Never drop accents or fall back to ASCII-only prose, even when reading code or comments written without accents.
</response_orthography>`;

export function appendAntigravitySessionInstructions(base: string): string {
  return `${base}\n\n${ANTIGRAVITY_ASK_QUESTION_INSTRUCTIONS}\n\n${ANTIGRAVITY_ORTHOGRAPHY_INSTRUCTIONS}`;
}

const isForm = Schema.is(
  Schema.Struct({
    properties: Schema.Record(Schema.String, Schema.Unknown),
    required: Schema.optional(Schema.Array(Schema.String)),
  }),
);

const choiceSchema = Schema.Struct({
  const: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  description: Schema.optional(Schema.String),
});

const isSingleTitledQuestion = Schema.is(
  Schema.Struct({
    type: Schema.Literal("string"),
    title: TrimmedNonEmptyString,
    description: Schema.optional(Schema.String),
    oneOf: Schema.Array(choiceSchema),
  }),
);

const isSingleEnumQuestion = Schema.is(
  Schema.Struct({
    type: Schema.Literal("string"),
    title: TrimmedNonEmptyString,
    description: Schema.optional(Schema.String),
    enum: Schema.Array(TrimmedNonEmptyString),
  }),
);

const isMultiTitledQuestion = Schema.is(
  Schema.Struct({
    type: Schema.Literal("array"),
    title: TrimmedNonEmptyString,
    description: Schema.optional(Schema.String),
    minItems: Schema.optional(Schema.Number),
    maxItems: Schema.optional(Schema.Number),
    items: Schema.Struct({
      anyOf: Schema.Array(choiceSchema),
    }),
  }),
);

const isMultiEnumQuestion = Schema.is(
  Schema.Struct({
    type: Schema.Literal("array"),
    title: TrimmedNonEmptyString,
    description: Schema.optional(Schema.String),
    minItems: Schema.optional(Schema.Number),
    maxItems: Schema.optional(Schema.Number),
    items: Schema.Struct({
      type: Schema.Literal("string"),
      enum: Schema.Array(TrimmedNonEmptyString),
    }),
  }),
);

const isCompanionField = Schema.is(
  Schema.Struct({
    type: Schema.Literal("string"),
    title: Schema.Literal("Other"),
    description: Schema.optional(Schema.String),
  }),
);

interface ParsedChoice {
  readonly value: string;
  readonly rawTitle: string;
  readonly label: string;
  readonly description: string;
}

interface ParsedQuestionEntry {
  readonly id: string;
  readonly title: string;
  readonly description: string | undefined;
  readonly multiSelect: boolean;
  readonly minItems: number;
  readonly maxItems: number;
  readonly required: boolean;
  readonly choices: ReadonlyArray<ParsedChoice>;
}

function copyBoundedText(text: string): string {
  return Buffer.from(text, "utf16le").toString("utf16le");
}

function boundText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const prefix = text.slice(0, limit - 3).replace(/[\uD800-\uDBFF]$/u, "");
  return copyBoundedText(`${prefix}...`);
}

function splitAtTopLevel(
  text: string,
  matchAt: (source: string, index: number) => number,
  maxLabelLength?: number,
): { readonly label: string; readonly description: string } | undefined {
  let parenDepth = 0;
  let bracketDepth = 0;
  let inDoubleQuote = false;
  let inBacktick = false;

  for (let index = 0; index < text.length; index++) {
    const ch = text[index]!;
    if (ch === "\\" && inDoubleQuote) {
      index += 1;
      continue;
    }
    if (ch === "`" && !inDoubleQuote) {
      inBacktick = !inBacktick;
      continue;
    }
    if (inBacktick) continue;
    if (ch === '"') {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (inDoubleQuote) continue;
    if (ch === "(") {
      parenDepth += 1;
      continue;
    }
    if (ch === ")" && parenDepth > 0) {
      parenDepth -= 1;
      continue;
    }
    if (ch === "[") {
      bracketDepth += 1;
      continue;
    }
    if (ch === "]" && bracketDepth > 0) {
      bracketDepth -= 1;
      continue;
    }
    if (parenDepth > 0 || bracketDepth > 0) continue;

    const length = matchAt(text, index);
    if (length <= 0) continue;
    const label = text.slice(0, index).trim();
    const description = text.slice(index + length).trim();
    if (
      label.length > 0 &&
      description.length > 0 &&
      (maxLabelLength === undefined || label.length <= maxLabelLength)
    ) {
      return { label, description };
    }
  }
  return undefined;
}

const matchWhitespaceDash = (pattern: RegExp) => (source: string, index: number) => {
  const match = pattern.exec(source.slice(index));
  return match ? match[0].length : 0;
};

const matchEmOrEnDash = matchWhitespaceDash(/^\s+[—–]\s+/);
const matchSpacedHyphen = matchWhitespaceDash(/^\s+-\s+/);
const matchColonSpace = matchWhitespaceDash(/^:\s+/);

/**
 * Antigravity's native `ask_question` tool accepts plain `options: string[]`, so split
 * structured `Label — description` strings into label + muted description for the card UI.
 */
export function parseAntigravityQuestionOption(option: {
  readonly title: string;
  readonly description?: string | undefined;
}): { readonly label: string; readonly description: string } {
  const rawTitle = option.title.trim();
  const explicitDescription = option.description?.trim();
  if (explicitDescription && explicitDescription !== rawTitle) {
    return {
      label: boundText(rawTitle, OPTION_LABEL_LIMIT),
      description: boundText(explicitDescription, QUESTION_TEXT_LIMIT),
    };
  }

  const newlineIndex = rawTitle.search(/\r?\n/);
  if (newlineIndex > 0) {
    const label = rawTitle.slice(0, newlineIndex).trim();
    const description = rawTitle.slice(newlineIndex).trim();
    if (label.length > 0 && description.length > 0) {
      return {
        label: boundText(label, OPTION_LABEL_LIMIT),
        description: boundText(description, QUESTION_TEXT_LIMIT),
      };
    }
  }

  const split =
    splitAtTopLevel(rawTitle, matchEmOrEnDash) ??
    splitAtTopLevel(rawTitle, matchSpacedHyphen, SHORT_SEPARATOR_LABEL_LIMIT) ??
    splitAtTopLevel(rawTitle, matchColonSpace, SHORT_SEPARATOR_LABEL_LIMIT);
  if (split !== undefined) {
    return {
      label: boundText(split.label, OPTION_LABEL_LIMIT),
      description: boundText(split.description, QUESTION_TEXT_LIMIT),
    };
  }

  const bounded = boundText(rawTitle, OPTION_LABEL_LIMIT);
  return { label: bounded, description: bounded };
}

// Intake appends file references to a user's answer; keep them with the custom text.
function splitAttachments(value: string) {
  const marker = value.indexOf("\n\n");
  if (marker < 0) return undefined;
  const suffix = value.slice(marker);
  if (!/^\n\nAttached (?:image|file) "(?:\\.|[^"\\\r\n])*": "/.test(suffix)) return undefined;
  return { prefix: value.slice(0, marker), suffix };
}

function parseChoices(
  entries: ReadonlyArray<{
    readonly const: string;
    readonly title: string;
    readonly description?: string | undefined;
  }>,
): ReadonlyArray<ParsedChoice> | undefined {
  if (entries.length === 0) return undefined;
  return entries.map((entry) => {
    const parsed = parseAntigravityQuestionOption(entry);
    return {
      value: entry.const,
      rawTitle: entry.title.trim(),
      label: parsed.label,
      description: parsed.description,
    };
  });
}

function parseEnumChoices(entries: ReadonlyArray<string>): ReadonlyArray<ParsedChoice> | undefined {
  if (entries.length === 0) return undefined;
  return entries.map((value) => {
    const parsed = parseAntigravityQuestionOption({ title: value });
    return {
      value,
      rawTitle: value.trim(),
      label: parsed.label,
      description: parsed.description,
    };
  });
}

/**
 * Antigravity `ask_question` emits ACP `elicitation/create` forms with the full question in
 * `qN.title`, a generic envelope `message` ("The agent has a question."), and an optional
 * `qN_other` companion field. Invert header/question, fold `qN_other`, and split option copy.
 */
export const extractAntigravityElicitationForm: NonNullable<
  AcpAdapterV2Flavor["extractElicitationForm"]
> = (request) => {
  if (request.mode !== "form" || !isForm(request.requestedSchema)) return undefined;
  const { properties } = request.requestedSchema;
  const requiredSet = new Set(request.requestedSchema.required ?? []);
  const entries: Array<ParsedQuestionEntry> = [];

  for (const [id, field] of Object.entries(properties)) {
    if (!QUESTION_ID_PATTERN.test(id)) {
      const owner = id.endsWith(COMPANION_SUFFIX)
        ? id.slice(0, -COMPANION_SUFFIX.length)
        : undefined;
      if (
        owner === undefined ||
        !QUESTION_ID_PATTERN.test(owner) ||
        !Object.hasOwn(properties, owner)
      ) {
        return undefined;
      }
      continue;
    }
    const companion = properties[`${id}${COMPANION_SUFFIX}`];
    if (!isCompanionField(companion)) return undefined;

    if (isSingleTitledQuestion(field)) {
      const choices = parseChoices(field.oneOf);
      if (choices === undefined) return undefined;
      entries.push({
        id,
        title: field.title.trim(),
        description: field.description?.trim(),
        multiSelect: false,
        minItems: 0,
        maxItems: 1,
        required: requiredSet.has(id),
        choices,
      });
      continue;
    }
    if (isSingleEnumQuestion(field)) {
      const choices = parseEnumChoices(field.enum);
      if (choices === undefined) return undefined;
      entries.push({
        id,
        title: field.title.trim(),
        description: field.description?.trim(),
        multiSelect: false,
        minItems: 0,
        maxItems: 1,
        required: requiredSet.has(id),
        choices,
      });
      continue;
    }
    if (isMultiTitledQuestion(field) || isMultiEnumQuestion(field)) {
      const choices = isMultiTitledQuestion(field)
        ? parseChoices(field.items.anyOf)
        : parseEnumChoices(field.items.enum);
      if (choices === undefined) return undefined;
      const minItems =
        typeof field.minItems === "number" &&
        Number.isInteger(field.minItems) &&
        field.minItems >= 0
          ? field.minItems
          : 0;
      const maxItems =
        typeof field.maxItems === "number" &&
        Number.isInteger(field.maxItems) &&
        field.maxItems >= 0
          ? field.maxItems
          : Infinity;
      if (maxItems === 0 || minItems > maxItems || minItems > choices.length) return undefined;
      entries.push({
        id,
        title: field.title.trim(),
        description: field.description?.trim(),
        multiSelect: true,
        minItems,
        maxItems,
        required: requiredSet.has(id),
        choices,
      });
      continue;
    }
    return undefined;
  }

  if (entries.length === 0 || Object.keys(properties).length !== entries.length * 2) {
    return undefined;
  }

  const envelopeMessage = request.message.trim();
  const singleQuestionHeader =
    envelopeMessage.length > 0 && envelopeMessage.length <= HEADER_LIMIT
      ? envelopeMessage
      : "Question";

  const questions: Array<OrchestrationV2UserInputQuestion> = entries.map((entry, index) => {
    const header =
      entry.description && entry.description !== entry.title
        ? boundText(entry.description, HEADER_LIMIT)
        : entries.length === 1
          ? singleQuestionHeader
          : `Question ${index + 1}`;
    return {
      id: entry.id,
      header,
      question: boundText(entry.title, QUESTION_TEXT_LIMIT),
      options: entry.choices.map((choice) => ({
        label: choice.label,
        description: choice.description,
        value: choice.value,
      })),
      ...(entry.multiSelect ? { multiSelect: true } : {}),
      ...(entry.multiSelect && entry.minItems > 0 && entry.required ? { required: true } : {}),
    };
  });

  return {
    questions,
    respond: (answers): EffectAcpSchema.CreateElicitationResponse => {
      const contentEntries: Array<[string, EffectAcpSchema.ElicitationContentValue]> = [];
      for (const entry of entries) {
        const answer = Object.hasOwn(answers, entry.id) ? answers[entry.id] : undefined;
        const companionId = `${entry.id}${COMPANION_SUFFIX}`;
        const findChoice = (value: string) =>
          entry.choices.find((choice) => choice.value === value);

        if (entry.multiSelect) {
          if (Array.isArray(answer)) {
            const selectedSet = new Set<string>();
            const extras: Array<string> = [];
            for (const item of answer) {
              if (!Predicate.isString(item)) continue;
              if (findChoice(item) !== undefined) {
                selectedSet.add(item);
              } else if (item.trim().length > 0) {
                extras.push(item);
              }
            }
            const selected = [...selectedSet];
            if (selected.length > 0) {
              if (selected.length < entry.minItems || selected.length > entry.maxItems) {
                return { action: "cancel" };
              }
              contentEntries.push([entry.id, selected]);
              if (extras.length > 0) {
                contentEntries.push([companionId, extras.join("\n\n")]);
              }
            } else if (extras.length > 0) {
              contentEntries.push([companionId, extras.join("\n\n")]);
            } else if (answer.length > 0 || (entry.minItems > 0 && entry.required)) {
              return { action: "cancel" };
            } else {
              contentEntries.push([entry.id, []]);
            }
            continue;
          }
          if (Predicate.isString(answer) && answer.trim().length > 0) {
            contentEntries.push([companionId, answer]);
            continue;
          }
          return { action: "cancel" };
        }

        if (!Predicate.isString(answer)) return { action: "cancel" };
        const exact = findChoice(answer);
        if (exact !== undefined) {
          contentEntries.push([entry.id, answer]);
          continue;
        }
        if (answer.trim().length === 0) return { action: "cancel" };
        const split = splitAttachments(answer);
        const attached = split === undefined ? undefined : findChoice(split.prefix);
        if (attached !== undefined && split !== undefined) {
          contentEntries.push([entry.id, split.prefix]);
          contentEntries.push([companionId, `${attached.rawTitle}${split.suffix}`]);
        } else {
          contentEntries.push([companionId, answer]);
        }
      }
      return { action: "accept", content: Object.fromEntries(contentEntries) };
    },
  };
};
