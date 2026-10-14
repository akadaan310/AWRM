import { CHAIN } from './chain';
import { E001 } from './e001';
import { E002 } from './e002';
import { E003 } from './e003';
import { E004 } from './e004';
import { E005 } from './e005';
import { E006 } from './e006';
import { E007 } from './e007';
import { E008 } from './e008';
import { E009 } from './e009';
import { E010 } from './e010';
import { E011 } from './e011';
import { E012 } from './e012';
import { X001 } from './x001';
import type { ExperimentResult } from '../harness';

export const EXPERIMENTS: Record<string, () => Promise<ExperimentResult>> = { E001, E002, E003, E004, E005, E006, E007, E008, E009, E010, E011, E012, CHAIN, X001 };
