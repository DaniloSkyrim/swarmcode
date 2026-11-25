// Fork: compact swarm status bar above the mobile composer that opens the ThreadSwarm sheet.
import { useNavigation } from "@react-navigation/native";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Haptics from "expo-haptics";
import { T, useGT, Var } from "gt-react-native";
import { Keyboard, Platform, Pressable, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";
import { useAgySwarm } from "../../state/agySwarm";

/** Shown only while the thread coordinates or participates in a swarm. */
export function ThreadSwarmBar(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const navigation = useNavigation();
  const gt = useGT();
  const { swarm } = useAgySwarm(props.environmentId, props.threadId);
  if (swarm === null) return null;

  const live = swarm.members.filter((member) => member.state !== "killed");
  const working = live.filter((member) => member.state === "working").length;
  const title = swarm.title.trim() === "" ? gt("Swarm board") : swarm.title;

  return (
    <View
      className={cn("px-4 py-1.5", Platform.OS === "android" ? "bg-thread-canvas" : "bg-screen")}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={gt("Open swarm board {title}", { title })}
        onPress={() => {
          Keyboard.dismiss();
          void Haptics.selectionAsync();
          navigation.navigate("ThreadSwarm", {
            environmentId: props.environmentId,
            threadId: props.threadId,
          });
        }}
        className="flex-row items-center gap-2 rounded-2xl bg-subtle px-3 py-2 active:opacity-70"
      >
        <SymbolView
          name="point.3.connected.trianglepath.dotted"
          size={14}
          tintColorClassName="accent-foreground-muted"
        />
        <Text numberOfLines={1} className="min-w-0 flex-1 text-xs font-t3-medium text-foreground">
          {title}
        </Text>
        <Text className="shrink-0 text-xs tabular-nums text-foreground-muted">
          {swarm.doneAt !== null ? (
            <T>Done</T>
          ) : working > 0 ? (
            <T>
              <Var>{working}</Var> working
            </T>
          ) : (
            gt("{count, plural, one {{count} member} other {{count} members}}", {
              count: live.length,
            })
          )}
        </Text>
        <SymbolView name="chevron.right" size={12} tintColorClassName="accent-foreground-muted" />
      </Pressable>
    </View>
  );
}
