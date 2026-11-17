import type { ComponentType } from "preact";
import type { SegmentId } from "../../shared/scheduler";
import { Air } from "./Air";
import { Almanac } from "./Almanac";
import { Daily } from "./Daily";
import { Grade } from "./Grade";
import { Hourly } from "./Hourly";
import { Local } from "./Local";
import { Note } from "./Note";
import { Now } from "./Now";
import { Outlook } from "./Outlook";
import { Radar } from "./Radar";
import { Reports } from "./Reports";
import { Studio } from "./Studio";
import { Text } from "./Text";

export const SEGMENT_VIEWS: Record<SegmentId, ComponentType> = {
  now: Now,
  radar: Radar,
  hourly: Hourly,
  daily: Daily,
  text: Text,
  outlook: Outlook,
  air: Air,
  almanac: Almanac,
  note: Note,
  studio: Studio,
  reports: Reports,
  local: Local,
  grade: Grade,
};
