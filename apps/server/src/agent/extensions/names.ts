/**
 * The names of the work extensions. They live apart from `work.ts` because the role table names them
 * and `work.ts` asks the role table which extensions a worker gets, so neither can import the other.
 */
export const WORK = "work"
export const WORK_STEPS = "work-steps"
