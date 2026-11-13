import conceptData from "../../../data/taxonomy/grocery-concepts.json";
import { normalizeSearchText } from "../normalize";
import type { SearchScope } from "./types";

type Concept = { labels: string[]; parents: string[]; substitutes: string[]; related: string[] };
const concepts = conceptData as Record<string, Concept>;

function labelMatches(text: string, label: string): boolean {
  return ` ${text} `.includes(` ${normalizeSearchText(label)} `);
}

export function directConcepts(text: string): string[] {
  const normalized = normalizeSearchText(text);
  const matches = Object.entries(concepts).flatMap(([id, concept]) => concept.labels
    .filter((label) => labelMatches(normalized, label))
    .map((label) => ({ id, wordCount: normalizeSearchText(label).split(" ").length })));
  const longest = Math.max(0, ...matches.map((match) => match.wordCount));
  return [...new Set(matches.filter((match) => match.wordCount === longest).map((match) => match.id))];
}

function ancestors(conceptId: string, found = new Set<string>()): Set<string> {
  if (found.has(conceptId)) return found;
  found.add(conceptId);
  for (const parent of concepts[conceptId]?.parents ?? []) ancestors(parent, found);
  return found;
}

export function conceptsForDocument(text: string): string[] {
  return [...new Set(directConcepts(text).flatMap((id) => [...ancestors(id)]))];
}

export function queryConcepts(query: string, scope: SearchScope): Set<string> {
  const direct = directConcepts(query);
  const expanded = new Set<string>(direct);
  for (const conceptId of direct) {
    for (const parent of concepts[conceptId]?.parents ?? []) expanded.add(parent);
    if (scope === "substitutes" || scope === "related") {
      for (const substitute of concepts[conceptId]?.substitutes ?? []) {
        for (const substituteConcept of directConcepts(substitute)) expanded.add(substituteConcept);
      }
    }
    if (scope === "related") {
      for (const related of concepts[conceptId]?.related ?? []) expanded.add(related);
    }
  }
  return expanded;
}

export function conceptLabels(conceptId: string): string[] {
  return concepts[conceptId]?.labels ?? [];
}
