<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from '@/api';
import type { Graph } from '@/types';
import FolderPicker from '@/components/FolderPicker.vue';
import ProjectView from '@/components/ProjectView.vue';
import GraphView from '@/components/GraphView.vue';

const STORAGE_KEY = 'learn-gui:project';

function loadSaved(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
function save(slug: string | null) {
  try {
    if (slug) localStorage.setItem(STORAGE_KEY, slug);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

const tab = ref<'project' | 'graph'>('project');
const slug = ref<string | null>(loadSaved());
const picking = ref(slug.value === null);
const openError = ref('');
const graph = ref<Graph | null>(null);
const graphError = ref('');
let events: EventSource | null = null;

async function loadGraph() {
  try {
    graph.value = await api.getGraph();
    graphError.value = '';
  } catch (e) {
    graphError.value = (e as Error).message;
  }
}

async function openProject(path: string) {
  openError.value = '';
  try {
    const p = await api.openProject(path);
    slug.value = p.slug;
    save(p.slug);
    picking.value = false;
    tab.value = 'project';
  } catch (e) {
    openError.value = (e as Error).message;
  }
}

onMounted(() => {
  loadGraph();
  events = new EventSource('/api/events');
  events.addEventListener('graph', loadGraph);
});
onBeforeUnmount(() => events?.close());
</script>

<template>
  <div class="mx-auto min-h-screen max-w-[1500px] px-4 pb-10 sm:px-6">
    <header class="flex flex-wrap items-center justify-between gap-3 py-4">
      <h1 class="text-lg font-semibold">Learn Rust from a project</h1>
      <nav class="flex gap-1 text-sm" aria-label="Views">
        <button
          class="rounded-md px-3 py-1.5"
          :class="tab === 'project' ? 'bg-zinc-800' : 'hover:bg-zinc-900'"
          @click="tab = 'project'"
        >
          Project
        </button>
        <button
          class="rounded-md px-3 py-1.5"
          :class="tab === 'graph' ? 'bg-zinc-800' : 'hover:bg-zinc-900'"
          @click="tab = 'graph'"
        >
          Knowledge graph
        </button>
        <button
          v-if="slug && !picking"
          class="rounded-md px-3 py-1.5 text-zinc-400 hover:bg-zinc-900"
          @click="((picking = true), (tab = 'project'))"
        >
          Change project
        </button>
      </nav>
    </header>

    <main>
      <template v-if="tab === 'project'">
        <p v-if="openError" class="mb-3 text-sm text-red-400" role="alert">{{ openError }}</p>
        <FolderPicker v-if="picking || !slug" @open="openProject" />
        <ProjectView v-else :slug="slug" @progress="graph = $event" />
      </template>
      <GraphView v-else :graph="graph" :error="graphError" />
    </main>
  </div>
</template>
