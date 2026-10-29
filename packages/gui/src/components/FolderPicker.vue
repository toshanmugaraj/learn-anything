<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '@/api';
import type { FsListing } from '@/types';

const emit = defineEmits<{ open: [path: string] }>();

const listing = ref<FsListing | null>(null);
const pathInput = ref('');
const error = ref('');
const loading = ref(false);

async function go(path = '') {
  loading.value = true;
  error.value = '';
  try {
    listing.value = await api.listDirs(path);
    pathInput.value = listing.value.path;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

onMounted(() => go());
</script>

<template>
  <div class="mx-auto max-w-2xl">
    <h2 class="text-xl font-semibold">Open a Rust project</h2>
    <p class="mt-1 text-sm text-zinc-400">
      Find the root folder of a Rust project on this machine (the one with <code class="font-mono">Cargo.toml</code>).
    </p>

    <form class="mt-4 flex gap-2" @submit.prevent="go(pathInput)">
      <input
        v-model="pathInput"
        class="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm"
        aria-label="Folder path"
        placeholder="/path/to/rust/project"
      />
      <button class="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800" type="submit">Go</button>
    </form>

    <p v-if="error" class="mt-3 text-sm text-red-400" role="alert">{{ error }}</p>

    <div v-if="listing" class="mt-4 rounded-lg border border-zinc-800">
      <div class="flex items-center justify-between gap-3 border-b border-zinc-800 px-3 py-2">
        <button
          class="text-sm text-zinc-300 hover:underline disabled:opacity-40"
          :disabled="!listing.parent"
          @click="listing.parent && go(listing.parent)"
        >
          &larr; Up
        </button>
        <button
          class="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
          :disabled="!listing.isCargo"
          :title="listing.isCargo ? '' : 'This folder has no Cargo.toml'"
          @click="emit('open', listing.path)"
        >
          Use this folder
        </button>
      </div>
      <ul class="max-h-96 overflow-auto">
        <li v-if="!listing.entries.length" class="px-3 py-3 text-sm text-zinc-500">No sub-folders here.</li>
        <li v-for="e in listing.entries" :key="e.path">
          <button
            class="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-zinc-900"
            :disabled="loading"
            @click="go(e.path)"
          >
            <span class="font-mono">{{ e.name }}/</span>
            <span v-if="e.isCargo" class="rounded bg-orange-500/20 px-1.5 py-0.5 text-xs text-orange-300">Rust</span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
