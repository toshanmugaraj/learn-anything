<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { Snippet } from '@/types';
import { highlightLine } from '@/utils/highlight';

const props = defineProps<{ file: Snippet; highlight: [number, number] | null }>();

const root = ref<HTMLElement | null>(null);

const lines = computed(() =>
  props.file.code.split('\n').map((text, i) => ({
    n: props.file.startLine + i,
    html: highlightLine(text, props.file.language) || '&nbsp;',
  })),
);

function isMarked(n: number) {
  return props.highlight !== null && n >= props.highlight[0] && n <= props.highlight[1];
}

watch(
  () => props.highlight,
  async (range) => {
    if (!range) return;
    await nextTick();
    root.value?.querySelector(`[data-line="${range[0]}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  },
);
</script>

<template>
  <div ref="root" class="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
    <div class="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5 font-mono text-xs text-zinc-400">
      <span>{{ file.path }}</span>
      <span>lines {{ file.startLine }}-{{ file.endLine }} of {{ file.totalLines }}</span>
    </div>
    <div class="max-h-[28rem] overflow-auto py-2 font-mono text-[13px] leading-5">
      <div
        v-for="line in lines"
        :key="line.n"
        :data-line="line.n"
        class="flex"
        :class="isMarked(line.n) ? 'bg-violet-500/15' : ''"
      >
        <span class="w-12 shrink-0 select-none pr-3 text-right text-zinc-600">{{ line.n }}</span>
        <!-- hljs escapes the source text; the output is safe to render -->
        <span class="whitespace-pre pr-4" v-html="line.html" />
      </div>
    </div>
  </div>
</template>
