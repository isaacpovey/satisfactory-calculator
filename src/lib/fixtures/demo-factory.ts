import type { PlannerInput, SolveResult } from "@/lib/solver/types";
import demoFixture from "./demo-factory.json";

export interface DemoFactoryFixture {
  name: string;
  plannerInput: PlannerInput;
  result: SolveResult;
}

export const DEMO_FACTORY_FIXTURE = demoFixture as DemoFactoryFixture;
