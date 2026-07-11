import type { ProductionStage, SolveResult } from "@/lib/solver/types";

export interface BuildSection {
  id: string;
  stageId: string;
  label: string;
}

export function buildSectionsForStage(stage: ProductionStage): BuildSection[] {
  const sections: BuildSection[] = [];

  if (stage.inputBelts.length > 0) {
    sections.push({
      id: `${stage.recipeId}:inputs`,
      stageId: stage.recipeId,
      label: "Input belts",
    });
  }

  stage.groups.forEach((_g, i) => {
    sections.push({
      id: `${stage.recipeId}:bank:${i}`,
      stageId: stage.recipeId,
      label: `Bank ${i + 1}`,
    });
  });

  stage.outputMerges.forEach((_m, i) => {
    sections.push({
      id: `${stage.recipeId}:merge:${i}`,
      stageId: stage.recipeId,
      label: `Output merge ${i + 1}`,
    });
  });

  return sections;
}

export function buildSectionsForResult(result: SolveResult): BuildSection[] {
  return result.network.stages.flatMap(buildSectionsForStage);
}

export function stageProgress(
  stage: ProductionStage,
  builtSections: Set<string>,
): { built: number; total: number } {
  const sections = buildSectionsForStage(stage);
  const built = sections.filter((s) => builtSections.has(s.id)).length;
  return { built, total: sections.length };
}

export function overallBuildProgress(
  result: SolveResult,
  builtSections: Set<string>,
): { built: number; total: number } {
  const sections = buildSectionsForResult(result);
  const built = sections.filter((s) => builtSections.has(s.id)).length;
  return { built, total: sections.length };
}
