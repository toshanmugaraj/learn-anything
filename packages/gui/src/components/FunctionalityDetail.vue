<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { api } from '@/api';
import type { FunctionalityDetail } from '@/types';
import { renderMarkdown } from '@/utils/markdown';
import CodeBlock from './CodeBlock.vue';

const props = defineProps<{ slug: string; functionalityId: string; ticks: string[] }>();
const emit = defineEmits<{ toggle: [conceptSlug: string, checked: boolean] }>();

const detail = ref<FunctionalityDetail | null>(null);
const error = ref('');
const marked = ref<{ file: string; lines: [number, number] } | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;

function stopPolling() {
  clearTimeout(timer);
}

async function load(id: string) {
  const gen = ++generation;
  stopPolling();
  detail.value = null;
  error.value = '';
  marked.value = null;
  try {
    let d = await api.getFunctionality(props.slug, id);
    if (gen !== generation) return;
    detail.value = d;
    if (d.explainStatus === 'idle') {
      d = await api.explain(props.slug, id);
      if (gen !== generation) return;
      detail.value = d;
    }
    poll(id, gen);
  } catch (e) {
    if (gen === generation) error.value = (e as Error).message;
  }
}

function poll(id: string, gen: number) {
  if (detail.value?.explainStatus !== 'running') return;
  timer = setTimeout(async () => {
    try {
      const d = await api.getFunctionality(props.slug, id);
      if (gen !== generation) return;
      detail.value = d;
      poll(id, gen);
    } catch (e) {
      if (gen === generation) error.value = (e as Error).message;
    }
  }, 2000);
}

async function retry() {
  const gen = ++generation;
  error.value = '';
  try {
    detail.value = await api.explain(props.slug, props.functionalityId, true);
    poll(props.functionalityId, gen);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

watch(() => [props.slug, props.functionalityId], () => load(props.functionalityId), { immediate: true });
onBeforeUnmount(() => {
  generation++;
  stopPolling();
});

const concepts = computed(() => detail.value?.explanation?.concepts ?? []);

function highlightFor(path: string): [number, number] | null {
  return marked.value && marked.value.file === path ? marked.value.lines : null;
}

function show(c: { file?: string; lines?: [number, number] }) {
  marked.value = c.file && c.lines ? { file: c.file, lines: c.lines } : null;
}
</script>

<template>
  <div>
    <p v-if="error" class="mb-3 text-sm text-red-400" role="alert">{{ error }}</p>
    <p v-if="!detail && !error" class="text-sm text-zinc-400">Loading code&hellip;</p>

    <template v-if="detail">
      <h3 class="text-lg font-semibold">{{ detail.functionality.title }}</h3>

      <div class="mt-3 space-y-3">
        <CodeBlock v-for="f in detail.files" :key="f.path + f.startLine" :file="f" :highlight="highlightFor(f.path)" />
        <p v-if="!detail.files.length" class="text-sm text-orange-300">
          The source for this functionality is no longer at the recorded location. Re-analyze the project.
        </p>
      </div>

      <section class="mt-6">
        <h4 class="text-sm font-semibold uppercase tracking-wide text-zinc-400">Rust concepts in this code</h4>

        <p v-if="detail.explainStatus === 'running'" class="mt-2 text-sm text-zinc-400">
          Claude is explaining this code&hellip; this can take a minute.
        </p>
        <div v-if="detail.explainStatus === 'error'" class="mt-2 text-sm text-red-400" role="alert">
          {{ detail.explainError }}
          <button class="ml-2 underline" @click="retry">Try again</button>
        </div>

        <template v-if="detail.explanation">
          <p v-if="detail.explanation.summary" class="mt-2 text-sm text-zinc-300">{{ detail.explanation.summary }}</p>
          <ul class="mt-3 space-y-3">
            <li v-for="c in concepts" :key="c.slug" class="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
              <div class="flex items-start gap-3">
                <input
                  :id="`tick-${c.slug}`"
                  type="checkbox"
                  class="mt-1 h-4 w-4 accent-violet-500"
                  :checked="ticks.includes(c.slug)"
                  @change="emit('toggle', c.slug, ($event.target as HTMLInputElement).checked)"
                />
                <div class="min-w-0 flex-1">
                  <label :for="`tick-${c.slug}`" class="font-medium">{{ c.name }}</label>
                  <span class="ml-2 text-xs text-zinc-500">{{ c.domain }}</span>
                  <!-- sanitized with DOMPurify -->
                  <div class="note mt-1 text-sm text-zinc-300" v-html="renderMarkdown(c.note)" />
                  <button
                    v-if="c.file && c.lines"
                    class="mt-1 text-xs text-violet-300 hover:underline"
                    @click="show(c)"
                  >
                    Show in code (lines {{ c.lines[0] }}-{{ c.lines[1] }})
                  </button>
                </div>
              </div>
            </li>
          </ul>
          <p class="mt-3 text-xs text-zinc-500">Tick a concept once you understand it. It is added to your knowledge graph.</p>
        </template>
      </section>
    </template>
  </div>
</template>
