/**
 * C.3 retrieval-mode + research-need constants.
 * Tiny module to avoid import cycles between planner and retrieval.
 */

export const NEED_TYPES = {
  NO_EVIDENCE: "no_evidence",
  NEEDS_DIRECT: "needs_direct",
  NEEDS_READER_EVIDENCE: "needs_reader_evidence",
  NEEDS_DIVERSITY: "needs_diversity",
  SUPPORTING_SATURATED: "supporting_saturated",
  RESOLVED: "resolved",
};

export const RETRIEVAL_MODES = {
  GENERAL: "general",
  READER_DIRECT: "reader_direct",
  SCENE_DIRECT: "scene_direct",
  DIVERSITY: "diversity",
};
