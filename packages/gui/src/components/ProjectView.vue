<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { api } from '@/api';
import type { Graph, Project } from '@/types';
import FunctionalityDetail from './FunctionalityDetail.vue';

const props = defineProps<{ slug: string }>();
const emit = defineEmits<{ progress: [graph: Graph] }>();

const project = ref<Project | null>(null);
const selectedId = ref<string | null>(null);
const error = ref('');
let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;

async function refresh(gen: number) {
  try {
    const p = await api.getProject(props.slug);
    if (gen !== generation) return;
    project.value = p;
    if (p.status === 'running') timer = setTimeout(() => refresh(gen), 2000);
  } catch (e) {
    if (gen === generation) error.value = (e as Error).message;
  }
}

function start() {
  const gen = ++generation;
  clearTimeout(timer);
  project.value = null;
  selectedId.value = null;
  error.value = '';
  refresh(gen);
}

async function reanalyze() {
  if (!project.value) return;
  const gen = ++generation;
  clearTimeout(timer);
  selectedId.value = null;
  try {
    project.value = await api.openProject(project.value.path, true);
    if (project.value.status === 'running') timer = setTimeout(() => refresh(gen), 2000);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

watch(() => props.slug, start, { immediate: true });
onBeforeUnmount(() => {
  generation++;
  clearTimeout(timer);
});

const ticks = computed(() => project.value?.ticks ?? []);

async function toggle(conceptSlug: string, checked: boolean) {
  error.value = '';
  try {
    const result = await api.setProgress(props.slug, conceptSlug, checked);
    if (project.value) project.value = { ...project.value, ticks: result.ticks };
    emit('progress', result.graph);
  } catch (e) {
    error.value = (e as Error).message;
    // re-sync checkbox state with the server
    refresh(generation);
  }
}
</script>

<template>
  <div>
    <p v-if="error" class="mb-3 text-sm text-red-400" role="alert">{{ error }}</p>
    <p v-if="!project && !error" class="text-sm text-zinc-400">Loading project&hellip;</p>

    <template v-if="project">
      <div class="mb-4 flex items-center justify-between gap-3">
        <div class="min-w-0">
          <h2 class="truncate text-xl font-semibold">{{ project.name }}</h2>
          <p class="truncate font-mono text-xs text-zinc-500">{{ project.path }}</p>
        </div>
        <button
          class="shrink-0 rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800 disabled:opacity-40"
          :disabled="project.status === 'running'"
          @click="reanalyze"
        >
          Re-analyze
        </button>
      </div>

      <div v-if="project.status === 'running'" class="rounded-lg border border-zinc-800 p-4 text-sm text-zinc-300">
        Claude is reading the project to find its purpose and functionalities. This can take a few minutes.
      </div>
      <div v-else-if="project.status === 'error'" class="rounded-lg border border-red-900 p-4 text-sm text-red-300" role="alert">
        Analysis failed: {{ project.error }}
      </div>

      <div v-if="project.analysis" class="grid gap-6 lg:grid-cols-2">
        <section class="min-w-0 lg:max-h-[calc(100vh-11rem)] lg:overflow-auto lg:pr-2">
          <h3 class="text-2xl font-semibold">Purpose</h3>
          <p class="mt-2 leading-7 text-zinc-300">{{ project.analysis.purpose }}</p>

          <h3 class="mt-8 text-2xl font-semibold">Functionalities &amp; Requirements</h3>
          <ol class="mt-3 list-decimal space-y-4 pl-6 marker:text-zinc-500">
            <li v-for="f in project.analysis.functionalities" :key="f.id">
              <button
                class="text-left text-lg font-semibold hover:text-violet-300"
                :class="selectedId === f.id ? 'text-violet-300' : ''"
                :aria-current="selectedId === f.id"
                @click="selectedId = f.id"
              >
                {{ f.title }}
              </button>
              <ul class="mt-1 list-disc space-y-1 pl-6 text-zinc-300">
                <li v-if="f.description">{{ f.description }}</li>
                <li v-for="r in f.requirements" :key="r">{{ r }}</li>
              </ul>
            </li>
          </ol>
        </section>

        <section class="min-w-0 lg:max-h-[calc(100vh-11rem)] lg:overflow-auto lg:pr-2">
          <FunctionalityDetail
            v-if="selectedId"
            :slug="project.slug"
            :functionality-id="selectedId"
            :ticks="ticks"
            @toggle="toggle"
          />
          <p v-else class="rounded-lg border border-dashed border-zinc-800 p-6 text-sm text-zinc-500">
            Click a functionality on the left to see its code and the Rust concepts in it.
          </p>
        </section>
      </div>
    </template>
  </div>
</template>
