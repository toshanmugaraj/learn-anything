<script setup lang="ts">
import { computed } from 'vue';
import type { ConceptStatus, Graph } from '@/types';

const props = defineProps<{ graph: Graph | null; error: string }>();

const LABEL: Record<ConceptStatus, string> = {
  unexplored: 'Unexplored',
  in_progress: 'In progress',
  needs_practice: 'Needs practice',
  mastered: 'Mastered',
};
const STYLE: Record<ConceptStatus, string> = {
  unexplored: 'border-zinc-700 text-zinc-400',
  in_progress: 'border-blue-500 bg-blue-500/15 text-blue-200',
  needs_practice: 'border-orange-500 bg-orange-500/15 text-orange-200',
  mastered: 'border-green-500 bg-green-500/15 text-green-200',
};

const counts = computed(() => {
  const c: Record<ConceptStatus, number> = { unexplored: 0, in_progress: 0, needs_practice: 0, mastered: 0 };
  for (const d of props.graph?.domains ?? []) for (const k of d.concepts) c[k.status]++;
  return c;
});
</script>

<template>
  <div>
    <p v-if="error" class="text-sm text-red-400" role="alert">{{ error }}</p>
    <p v-else-if="!graph" class="text-sm text-zinc-400">Loading knowledge graph&hellip;</p>
    <template v-if="graph">
      <h2 class="text-xl font-semibold">{{ graph.topic }} knowledge graph</h2>
      <ul class="mt-2 flex flex-wrap gap-3 text-sm">
        <li v-for="(label, status) in LABEL" :key="status" class="rounded border px-2 py-0.5" :class="STYLE[status]">
          {{ label }}: {{ counts[status] }}
        </li>
      </ul>
      <div class="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        <section v-for="d in graph.domains" :key="d.slug" class="rounded-lg border border-zinc-800 p-3">
          <h3 class="font-semibold">{{ d.name }}</h3>
          <ul class="mt-2 flex flex-wrap gap-2">
            <li
              v-for="c in d.concepts"
              :key="c.slug"
              class="rounded-md border px-2 py-1 text-sm"
              :class="STYLE[c.status]"
              :title="`${LABEL[c.status]} · confidence ${c.confidence} · explained ${c.explain_count}x`"
            >
              {{ c.name }}
            </li>
          </ul>
        </section>
      </div>
    </template>
  </div>
</template>
