/**
 * NVIDIA TensorRT documentation provider
 *
 * Scrapes documentation from the NVIDIA TensorRT docs website
 * and stores it as markdown files.
 */
import type { DocProvider } from '../types'

export const tensorrtProvider: DocProvider = {
  name: 'tensorrt',
  displayName: 'NVIDIA TensorRT',
  repo: '',
  docsPath: '',
  extensions: ['.md'],
  excludePatterns: [],
  defaultBranch: 'latest',
  instruction:
    'IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for any NVIDIA TensorRT tasks. These docs cover TensorRT SDK for optimizing deep learning models for high-performance inference.',
  urlConfig: {
    baseUrl: 'https://docs.nvidia.com/deeplearning/tensorrt/latest/index.html',
    contentSelector: 'main#main-content, main, article, .body',
    removeSelectors: [
      '.headerlink',
      '.toctree-wrapper',
      '.breadcrumb',
      '.page-navigation',
      '.related-pages',
    ],
    pages: [
      // Getting Started
      'getting-started/release-notes.html',
      'getting-started/quick-start-guide.html',
      'getting-started/support-matrix.html',
      // Installing TensorRT
      'installing-tensorrt/overview.html',
      'installing-tensorrt/prerequisites.html',
      'installing-tensorrt/installing.html',
      'installing-tensorrt/upgrading.html',
      'installing-tensorrt/uninstalling.html',
      // Architecture
      'architecture/architecture-overview.html',
      'architecture/capabilities.html',
      'architecture/how-trt-works.html',
      // Inference Library
      'inference-library/c-api-docs.html',
      'inference-library/python-api-docs.html',
      'inference-library/sample-support-guide.html',
      'inference-library/advanced.html',
      'inference-library/work-quantized-types.html',
      'inference-library/accuracy-considerations.html',
      'inference-library/work-dynamic-shapes.html',
      'inference-library/extending-custom-layers.html',
      'inference-library/work-with-loops.html',
      'inference-library/work-with-conditionals.html',
      'inference-library/work-with-dla.html',
      'inference-library/capture-replay.html',
      'inference-library/work-with-transformers.html',
      // Performance
      'performance/best-practices.html',
      // API
      'api/c-api.html',
      'api/python-api.html',
      'api/migration-guide.html',
      'api/onnx-graphsurgeon-api.html',
      'api/polygraphy-api.html',
      // Reference
      'reference/troubleshooting.html',
      'reference/data-format-desc.html',
      'reference/command-line-programs.html',
      'reference/operators.html',
      'reference/additional-resources.html',
      'reference/glossary.html',
    ],
    concurrency: 3,
    fetchDelay: 300,
  },
}
