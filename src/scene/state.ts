import { computed } from "@preact/signals";
import { isSceneId, pickScene, type SceneId } from "../../shared/scene";
import { config, forecast } from "../state/store";

/** ?scene=rain forces a scene (handy for previews and screenshots). */
const forced = ((): SceneId | null => {
  try {
    const v = new URLSearchParams(location.search).get("scene");
    return isSceneId(v) ? v : null;
  } catch {
    return null;
  }
})();

export const scene = computed<SceneId | null>(() => {
  if (forced) return forced;
  if (!config.value.scenes) return null;
  const c = forecast.value?.current;
  return c ? pickScene(c.code, c.isDay, c.temp) : null;
});
