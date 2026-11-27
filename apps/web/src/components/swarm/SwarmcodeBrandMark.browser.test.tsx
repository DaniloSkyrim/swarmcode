import "~/index.css";

import { describe, expect, it } from "vite-plus/test";

import { render } from "../../../test/render";
import { SwarmcodeBrandMark } from "./SwarmcodeBrandMark";

describe("SwarmcodeBrandMark", () => {
  it("renders the Swarmcode wordmark and bee emblem on backdrop and plain chrome", async () => {
    await using onBackdropScreen = await render(<SwarmcodeBrandMark onBackdrop />);
    expect(onBackdropScreen.container.textContent).toBe("Swarmcode");
    expect(onBackdropScreen.container.querySelector("[data-swarmcode-brand]")).not.toBeNull();
    expect(onBackdropScreen.container.querySelectorAll("svg").length).toBe(3);

    await using plainScreen = await render(<SwarmcodeBrandMark onBackdrop={false} />);
    expect(plainScreen.container.textContent).toBe("Swarmcode");
  });
});
