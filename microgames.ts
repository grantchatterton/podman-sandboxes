import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

const pick = <T,>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]!;

export default function (pi: ExtensionAPI) {
  let close: (() => void) | undefined;
  let active = false;
  let best = 0;
  async function play(ctx: ExtensionContext) {
    if (ctx.mode !== "tui" || active) return;
    active = true;
    try {
      await ctx.ui.custom<void>((tui, theme, _keys, done) => {
        let score = 0, lives = 3, taps = 0, deadline = 0;
        let game = "", target = "", feedback = "";
        let next = 0;
        const now = () => performance.now();
        function round() {
          game = pick(["DODGE", "MASH", "TYPE", "FREEZE" ]);
          target = game === "DODGE" ? pick(["left", "right"]) : pick(["a", "s", "d", "f"]);
          taps = 0;
          feedback = "";
          deadline = now() + Math.max(850, 2700 - score * 115);
        }
        function finish(win: boolean) {
          if (win) best = Math.max(best, ++score);
          else lives--;
          feedback = win ? "NICE!" : "MISS!";
          next = now() + 450;
        }
        function tick() {
          if (!lives) return;
          if (feedback) {
            if (now() >= next) round();
          } else if (now() >= deadline) finish(game === "FREEZE");
        }
        round();
        close = () => done(undefined);
        const timer = setInterval(() => { tick(); tui.requestRender(); }, 50);
        return {
          invalidate() {},
          dispose() { clearInterval(timer); },
          handleInput(data: string) {
            if (matchesKey(data, "escape") || matchesKey(data, "ctrl+g")) return close?.();
            tick();
            if (!lives) {
              if (matchesKey(data, "enter")) { lives = 3; score = 0; round(); }
            } else if (!feedback) {
              if (game === "MASH" && data === " ") {
                if (++taps === 5) finish(true);
              } else finish(game === "DODGE" ? matchesKey(data, target as "left" | "right") : game === "TYPE" && data === target);
            }
            tui.requestRender();
          },
          render(width: number) {
            const prompt = game === "DODGE" ? `DODGE! Press ${target.toUpperCase()} arrow`
              : game === "TYPE" ? `TYPE! Press ${target.toUpperCase()} (lowercase)`
              : game === "MASH" ? `MASH! Space ${taps}/5` : "FREEZE! Don't press anything";
            return [
              theme.fg("accent", "  MICROGAMES"),
              `  Score ${score}   Lives ${lives}   Best ${best}`,
              "",
              `  ${!lives ? "GAME OVER — Enter to retry" : feedback || prompt}`,
              lives && !feedback ? `  ${(Math.max(0, deadline - now()) / 1000).toFixed(1)}s` : "",
              "  Esc or Ctrl+G to close",
            ].map(line => truncateToWidth(line, width));
          },
        };
      }, { overlay: true, overlayOptions: { width: 44 } });
    } finally { close = undefined; active = false; }
  }
  pi.registerCommand("microgames", { description: "Play a rapid-fire microgame marathon", handler: (_args, ctx) => play(ctx) });
  pi.registerShortcut("alt+g", { description: "Play microgames while pi works", handler: ctx => { void play(ctx).catch(error => ctx.ui.notify(String(error), "error")); } });
  pi.on("session_shutdown", () => { close?.(); });
}
