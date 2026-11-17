// "What do I do right now": deterministic, plain-language steps for an alert.
// Safety rule: this is template text only. No LLM ever writes or edits it.
import type { Alert } from "./types";
import { isEmergency } from "./threat";

export interface SafetyPlan {
  /** where this household shelters from a tornado, e.g. "the basement, under the stairs" */
  shelter: string;
  /** where to go if you're told to leave (flood, surge, fire), e.g. "Aunt Pat's in Lansdale" */
  evacuation: string;
}

export const EMPTY_PLAN: SafetyPlan = { shelter: "", evacuation: "" };

export interface ActionCard {
  /** "now" = act this minute, "prepare" = get ready, "aware" = keep an eye on it */
  urgency: "now" | "prepare" | "aware";
  title: string;
  steps: string[];
}

const night = (hour: number): boolean => hour >= 21 || hour < 6;
const shelterLine = (p: SafetyPlan): string =>
  p.shelter.trim()
    ? `Go to ${p.shelter.trim().replace(/[.\s]+$/, "")} now.`
    : "Go to a basement, or a small room on the lowest floor with no windows.";
const leaveLine = (p: SafetyPlan): string =>
  p.evacuation.trim() ? `If you're told to leave, go to ${p.evacuation.trim().replace(/[.\s]+$/, "")}.` : "If you're told to leave, go right away.";

/**
 * Build the action card for one alert. Returns null for alerts with no useful action
 * (minor statements and the like).
 * @param hour local hour 0..23 at the viewer's location
 */
export function actionFor(a: Alert, hour: number, plan: SafetyPlan = EMPTY_PLAN): ActionCard | null {
  const e = a.event.toLowerCase();
  const emergency = isEmergency(a);
  const wake = night(hour) ? ["Wake everyone up. Bring phones and shoes."] : [];

  if (e.includes("tornado warning") || e.includes("tornado emergency")) {
    return {
      urgency: "now",
      title: emergency ? "A tornado is on the ground. Take cover now." : "Take cover now.",
      steps: [
        shelterLine(plan),
        ...wake,
        "Stay away from windows. Get under something sturdy.",
        "Cover your head and neck. Wear a helmet if you have one.",
        "In a car or mobile home? Get to a sturdy building now.",
      ],
    };
  }
  if (e.includes("tornado watch")) {
    return {
      urgency: "prepare",
      title: "Tornadoes are possible. Be ready to move fast.",
      steps: [
        "Know where you'll shelter: " + (plan.shelter.trim() || "the lowest floor, away from windows") + ".",
        "Keep your phone charged and alerts turned on.",
        "Clear a path to your shelter. Put shoes by the door.",
        ...(night(hour) ? ["Keep a loud alert on overnight so it can wake you."] : []),
      ],
    };
  }
  if (e.includes("severe thunderstorm warning")) {
    return {
      urgency: "now",
      title: emergency ? "Destructive winds are coming. Get inside now." : "Get inside, away from windows.",
      steps: [
        "Go indoors. Move to an inside room on the lowest floor.",
        ...wake,
        "Stay away from windows. Large hail and wind can break them.",
        "Don't drive into the storm. Pull over away from trees and power lines.",
        ...(emergency ? [shelterLine(plan)] : []),
      ],
    };
  }
  if (e.includes("severe thunderstorm watch")) {
    return {
      urgency: "prepare",
      title: "Strong storms are possible.",
      steps: ["Bring in or tie down loose things outside.", "Charge your phone and flashlights.", "Plan to get inside when storms arrive."],
    };
  }
  if (e.includes("flash flood warning") || e.includes("flash flood emergency")) {
    return {
      urgency: "now",
      title: emergency ? "Deadly flooding. Get to higher ground now." : "Flooding is happening. Avoid flooded roads.",
      steps: [
        "Turn around, don't drown. Never drive or walk through flood water.",
        "Move to higher ground if water is rising near you.",
        ...wake,
        leaveLine(plan),
      ],
    };
  }
  if (e.includes("flood warning") || e.includes("coastal flood warning")) {
    return {
      urgency: "prepare",
      title: "Flooding is expected.",
      steps: ["Never drive through flooded roads.", "Move valuables and cars to higher ground.", leaveLine(plan)],
    };
  }
  if (e.includes("flash flood watch") || e.includes("flood watch") || e.includes("coastal flood advisory")) {
    return {
      urgency: "aware",
      title: "Flooding is possible.",
      steps: ["Know a route to higher ground.", "Don't park in low spots or near creeks."],
    };
  }
  if (e.includes("hurricane warning") || e.includes("storm surge warning")) {
    return {
      urgency: "now",
      title: "Finish preparing now. Follow evacuation orders.",
      steps: [leaveLine(plan), "Bring in everything loose outside.", "Have water, medicine and chargers ready.", "Stay inside, away from windows, once the wind starts."],
    };
  }
  if (e.includes("tropical storm warning") || e.includes("hurricane watch") || e.includes("tropical storm watch")) {
    return {
      urgency: "prepare",
      title: "A tropical storm is coming.",
      steps: ["Bring in loose things outside.", "Charge phones and get water and medicine ready.", "Check on neighbors who may need help."],
    };
  }
  if (e.includes("blizzard warning") || e.includes("ice storm warning") || e.includes("winter storm warning")) {
    return {
      urgency: "prepare",
      title: e.includes("ice") ? "Ice is coming. Stay off the roads." : "A big winter storm is coming.",
      steps: [
        "Avoid travel if you can.",
        "Have flashlights, blankets and charged phones ready for power outages.",
        "If you must drive, keep a blanket, water and a charger in the car.",
      ],
    };
  }
  if (e.includes("winter weather advisory") || e.includes("winter storm watch")) {
    return { urgency: "aware", title: "Slippery travel is possible.", steps: ["Leave extra time.", "Slow down on bridges and ramps."] };
  }
  if (e.includes("extreme heat") || e.includes("excessive heat") || e.includes("heat advisory")) {
    const warn = e.includes("warning");
    return {
      urgency: warn ? "now" : "prepare",
      title: warn ? "Dangerous heat. Stay cool." : "It will be very hot.",
      steps: [
        "Drink water often. Stay in air conditioning if you can.",
        "Check on older relatives and neighbors twice a day.",
        "Never leave a child or pet in a car.",
        "Limit hard work outside to early morning.",
      ],
    };
  }
  if (e.includes("extreme cold") || e.includes("wind chill warning") || e.includes("cold weather advisory") || e.includes("wind chill advisory")) {
    return {
      urgency: e.includes("warning") ? "now" : "prepare",
      title: "Dangerous cold.",
      steps: ["Cover skin. Frostbite can start in minutes.", "Check on older relatives and neighbors.", "Bring pets inside.", "Never heat your home with a stove or grill."],
    };
  }
  if (e.includes("high wind warning") || e.includes("wind advisory")) {
    return {
      urgency: e.includes("warning") ? "prepare" : "aware",
      title: "Strong winds.",
      steps: ["Secure loose things outside.", "Watch for falling branches and power lines.", "Charge your phone in case the power goes out."],
    };
  }
  if (e.includes("red flag warning") || e.includes("fire weather")) {
    return { urgency: "aware", title: "Fires can spread fast today.", steps: ["No outdoor burning.", "Don't toss cigarettes. Avoid sparks from equipment."] };
  }
  if (e.includes("dense fog")) {
    return { urgency: "aware", title: "Thick fog.", steps: ["Slow down and use low beams.", "Leave extra room between cars."] };
  }
  if (e.includes("air quality")) {
    return { urgency: "aware", title: "Unhealthy air.", steps: ["Limit time outside, especially for kids, older adults and anyone with asthma.", "Keep windows closed."] };
  }
  return null;
}

/** Where a watch/advisory/warning ranks for "which card do I show first". */
export function urgencyRank(u: ActionCard["urgency"]): number {
  return u === "now" ? 2 : u === "prepare" ? 1 : 0;
}
