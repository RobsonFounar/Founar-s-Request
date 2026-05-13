import type { CSSProperties, MouseEvent } from 'react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './App.css'
import {
  buildVariableNameSet,
  collectMissingVariables,
  resolveRequestInput,
} from './lib/environments'
import {
  VariableHighlightedInput,
  VariableHighlightedTextarea,
} from './components/VariableHighlight'
import { JsonViewer } from './components/JsonViewer'
import { formatJsonWithVariables, isJsonValid } from './lib/jsonFormatter'
import { importCurl, importOpenApi } from './lib/importers'
import {
  executeRequest,
  runLoadTest,
} from './lib/requestRunner'
import type {
  AuthConfig,
  CollectionItem,
  EnvironmentColor,
  EnvironmentItem,
  ExecuteRequestInput,
  HistoryEntry,
  HttpMethod,
  KeyValueRow,
  LoadTestConfig,
  LoadTestLogEntry,
  LoadTestMode,
  LoadTestResult,
  LoadTestSample,
  RequestBody,
  RequestResponse,
  RequestTab,
  SavedRequestItem,
} from './types'

const METHODS: HttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]

type RequestConfigTabId = 'query' | 'auth' | 'headers' | 'body'

const REQUEST_CONFIG_TAB_OPTIONS: ReadonlyArray<{
  id: RequestConfigTabId
  label: string
}> = [
  { id: 'query', label: 'Query params' },
  { id: 'auth', label: 'Autenticação' },
  { id: 'headers', label: 'Headers' },
  { id: 'body', label: 'Request' },
]

const TABS_STORAGE_KEY = 'runner.tabs'
const ACTIVE_TAB_STORAGE_KEY = 'runner.activeTabId'
const HISTORY_STORAGE_KEY = 'runner.history'
const COLLECTIONS_STORAGE_KEY = 'runner.collections'
const ACTIVE_COLLECTION_STORAGE_KEY = 'runner.activeCollectionId'
const ENVIRONMENTS_STORAGE_KEY = 'runner.environments'
const ACTIVE_ENVIRONMENT_STORAGE_KEY = 'runner.activeEnvironmentId'
const HISTORY_LIMIT = 20
const DEFAULT_LOAD_TEST_CONFIG: LoadTestConfig = {
  mode: 'duration',
  totalRequests: 20,
  durationSeconds: 30,
  concurrency: 5,
}
const LOAD_TEST_MIN_DURATION_SECONDS = 1
const LOAD_TEST_MAX_DURATION_SECONDS = 600
const ENVIRONMENT_COLOR_OPTIONS: Array<{
  value: EnvironmentColor
  label: string
}> = [
  { value: 'verde', label: 'Verde' },
  { value: 'vermelho', label: 'Vermelho' },
  { value: 'amarelo', label: 'Amarelo' },
  { value: 'branco', label: 'Branco' },
  { value: 'lilas', label: 'Lilás' },
]

const ENVIRONMENT_COLOR_CSS: Record<EnvironmentColor, string> = {
  verde: '#22c55e',
  vermelho: '#ef4444',
  amarelo: '#facc15',
  branco: '#f8fafc',
  lilas: '#c084fc',
}

function BrandFounar() {
  return (
    <>
      <span className="brand-initial">F</span>
      ounar
    </>
  )
}

function BrandRequest() {
  return (
    <>
      <span className="brand-initial">R</span>
      equest
    </>
  )
}

function BrandFounarRequest({ separator = ' ' }: { separator?: string }) {
  return (
    <>
      <BrandFounar />
      {separator}
      <BrandRequest />
    </>
  )
}

const createRow = (key = '', value = ''): KeyValueRow => ({
  id: crypto.randomUUID(),
  key,
  value,
  enabled: true,
})

const createDefaultTab = (index: number): RequestTab => ({
  id: crypto.randomUUID(),
  name: `Request ${index}`,
  method: 'GET',
  url: '',
  headers: [createRow()],
  queryParams: [createRow()],
  auth: { type: 'none' },
  body: { mode: 'none' },
})

const createDefaultEnvironment = (index: number): EnvironmentItem => ({
  id: crypto.randomUUID(),
  name: index === 1 ? 'Default' : `Environment ${index}`,
  color: 'branco',
  variables: [createRow()],
})

const createDefaultCollection = (index: number): CollectionItem => ({
  id: crypto.randomUUID(),
  name: index === 1 ? 'Minha Collection' : `Collection ${index}`,
  requests: [],
})

const readStorage = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)

    if (!raw) {
      return fallback
    }

    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

const cloneTab = (tab: RequestTab): RequestTab => ({
  ...tab,
  id: crypto.randomUUID(),
  headers: tab.headers.map((row) => ({ ...row, id: crypto.randomUUID() })),
  queryParams: tab.queryParams.map((row) => ({
    ...row,
    id: crypto.randomUUID(),
  })),
  body:
    tab.body.mode === 'form'
      ? {
          ...tab.body,
          entries: tab.body.entries.map((row) => ({
            ...row,
            id: crypto.randomUUID(),
          })),
        }
      : { ...tab.body },
  response: tab.response ? { ...tab.response } : undefined,
  isSending: false,
  collectionId: undefined,
  savedRequestId: undefined,
})

const buildRequestInput = (tab: RequestTab): ExecuteRequestInput => ({
  method: tab.method,
  url: tab.url,
  headers: tab.headers,
  queryParams: tab.queryParams,
  auth: tab.auth,
  body: tab.body,
})

function App() {
  const [tabs, setTabs] = useState<RequestTab[]>(() => {
    const stored = readStorage<RequestTab[]>(TABS_STORAGE_KEY, [])

    if (stored.length === 0) {
      return [createDefaultTab(1)]
    }

    return stored.map(hydrateTab)
  })
  const [activeTabId, setActiveTabId] = useState(() =>
    readStorage<string>(ACTIVE_TAB_STORAGE_KEY, ''),
  )
  const [history, setHistory] = useState<HistoryEntry[]>(() =>
    readStorage<HistoryEntry[]>(HISTORY_STORAGE_KEY, []).map(hydrateHistoryEntry),
  )
  const [collections, setCollections] = useState<CollectionItem[]>(() => {
    const stored = readStorage<CollectionItem[]>(COLLECTIONS_STORAGE_KEY, [])

    if (stored.length === 0) {
      return [createDefaultCollection(1)]
    }

    return stored.map(hydrateCollection)
  })
  const [activeCollectionId, setActiveCollectionId] = useState(() =>
    readStorage<string>(ACTIVE_COLLECTION_STORAGE_KEY, ''),
  )
  const [curlImportText, setCurlImportText] = useState('')
  const [openApiImportText, setOpenApiImportText] = useState('')
  const [importFeedback, setImportFeedback] = useState<{
    tone: 'success' | 'error'
    message: string
  } | null>(null)
  const [loadTestConfig, setLoadTestConfig] = useState<LoadTestConfig>(
    DEFAULT_LOAD_TEST_CONFIG,
  )
  const [loadTestResult, setLoadTestResult] = useState<LoadTestResult | null>(null)
  const [loadTestFeedback, setLoadTestFeedback] = useState<string | null>(null)
  const [isRunningLoadTest, setIsRunningLoadTest] = useState(false)
  const [loadTestStartedAt, setLoadTestStartedAt] = useState<number | null>(null)
  const [loadTestNow, setLoadTestNow] = useState<number>(0)
  const [loadTestLogs, setLoadTestLogs] = useState<LoadTestLogEntry[]>([])
  const loadTestAbortRef = useRef<AbortController | null>(null)
  const [environments, setEnvironments] = useState<EnvironmentItem[]>(() => {
    const stored = readStorage<EnvironmentItem[]>(ENVIRONMENTS_STORAGE_KEY, [])

    if (stored.length === 0) {
      return [createDefaultEnvironment(1)]
    }

    return stored.map(hydrateEnvironment)
  })
  const [activeEnvironmentId, setActiveEnvironmentId] = useState(() =>
    readStorage<string>(ACTIVE_ENVIRONMENT_STORAGE_KEY, ''),
  )
  const [requestConfigTabId, setRequestConfigTabId] =
    useState<RequestConfigTabId>('body')

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
    [activeTabId, tabs],
  )
  const activeEnvironment = useMemo(
    () =>
      environments.find((environment) => environment.id === activeEnvironmentId) ??
      environments[0],
    [activeEnvironmentId, environments],
  )
  const activeCollection = useMemo(
    () =>
      collections.find((collection) => collection.id === activeCollectionId) ??
      collections[0],
    [activeCollectionId, collections],
  )
  const activeInput = useMemo(
    () => (activeTab ? buildRequestInput(activeTab) : undefined),
    [activeTab],
  )
  const resolvedInput = useMemo(
    () =>
      activeInput ? resolveRequestInput(activeInput, activeEnvironment) : undefined,
    [activeEnvironment, activeInput],
  )
  const missingVariables = useMemo(
    () =>
      activeInput ? collectMissingVariables(activeInput, activeEnvironment) : [],
    [activeEnvironment, activeInput],
  )
  const variableNames = useMemo(
    () => buildVariableNameSet(activeEnvironment),
    [activeEnvironment],
  )

  useEffect(() => {
    const persistedTabs = tabs.map((tab) => ({
      ...tab,
      isSending: false,
    }))

    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(persistedTabs))
  }, [tabs])

  useEffect(() => {
    if (!activeTab) {
      return
    }

    localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTab.id)
  }, [activeTab])

  useEffect(() => {
    setRequestConfigTabId('body')
  }, [activeTabId])

  useEffect(() => {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history))
  }, [history])

  useEffect(() => {
    localStorage.setItem(COLLECTIONS_STORAGE_KEY, JSON.stringify(collections))
  }, [collections])

  useEffect(() => {
    if (!activeCollection) {
      return
    }

    localStorage.setItem(ACTIVE_COLLECTION_STORAGE_KEY, activeCollection.id)
  }, [activeCollection])

  useEffect(() => {
    localStorage.setItem(
      ENVIRONMENTS_STORAGE_KEY,
      JSON.stringify(environments),
    )
  }, [environments])

  useEffect(() => {
    if (!activeEnvironment) {
      return
    }

    localStorage.setItem(ACTIVE_ENVIRONMENT_STORAGE_KEY, activeEnvironment.id)
  }, [activeEnvironment])

  useEffect(() => {
    if (!isRunningLoadTest) {
      return
    }

    const intervalId = window.setInterval(() => {
      setLoadTestNow(performance.now())
    }, 200)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [isRunningLoadTest])

  useEffect(() => {
    return () => {
      loadTestAbortRef.current?.abort()
    }
  }, [])

  const updateActiveTab = (updater: (tab: RequestTab) => RequestTab) => {
    if (!activeTab) {
      return
    }

    setTabs((currentTabs) =>
      currentTabs.map((tab) => (tab.id === activeTab.id ? updater(tab) : tab)),
    )
  }

  const addTab = (source?: RequestTab) => {
    const nextTab = source ? cloneTab(source) : createDefaultTab(tabs.length + 1)

    setTabs((currentTabs) => [...currentTabs, nextTab])
    setActiveTabId(nextTab.id)
  }

  const closeTab = (tabId: string) => {
    if (tabs.length === 1) {
      const freshTab = createDefaultTab(1)
      setTabs([freshTab])
      setActiveTabId(freshTab.id)
      return
    }

    const currentIndex = tabs.findIndex((tab) => tab.id === tabId)
    const nextTabs = tabs.filter((tab) => tab.id !== tabId)
    const nextActive = nextTabs[Math.max(currentIndex - 1, 0)] ?? nextTabs[0]

    setTabs(nextTabs)
    setActiveTabId(nextActive.id)
  }

  const updateActiveEnvironment = (
    updater: (environment: EnvironmentItem) => EnvironmentItem,
  ) => {
    if (!activeEnvironment) {
      return
    }

    setEnvironments((currentEnvironments) =>
      currentEnvironments.map((environment) =>
        environment.id === activeEnvironment.id ? updater(environment) : environment,
      ),
    )
  }

  const addEnvironment = (name: string, color: EnvironmentColor) => {
    const trimmed = name.trim()

    if (!trimmed) {
      return
    }

    const nextEnvironment = createDefaultEnvironment(environments.length + 1)

    setEnvironments((currentEnvironments) => [
      ...currentEnvironments,
      { ...nextEnvironment, name: trimmed, color },
    ])
    setActiveEnvironmentId(nextEnvironment.id)
  }

  const deleteActiveEnvironment = () => {
    if (!activeEnvironment) {
      return
    }

    if (environments.length === 1) {
      const freshEnvironment = createDefaultEnvironment(1)
      setEnvironments([freshEnvironment])
      setActiveEnvironmentId(freshEnvironment.id)
      return
    }

    const currentIndex = environments.findIndex(
      (environment) => environment.id === activeEnvironment.id,
    )
    const nextEnvironments = environments.filter(
      (environment) => environment.id !== activeEnvironment.id,
    )
    const nextActive =
      nextEnvironments[Math.max(currentIndex - 1, 0)] ?? nextEnvironments[0]

    setEnvironments(nextEnvironments)
    setActiveEnvironmentId(nextActive.id)
  }

  const addCollection = (name: string) => {
    const trimmed = name.trim()

    if (!trimmed) {
      return
    }

    const nextCollection = createDefaultCollection(collections.length + 1)

    setCollections((currentCollections) => [
      ...currentCollections,
      { ...nextCollection, name: trimmed },
    ])
    setActiveCollectionId(nextCollection.id)
  }

  const deleteActiveCollection = () => {
    if (!activeCollection) {
      return
    }

    if (collections.length === 1) {
      const freshCollection = createDefaultCollection(1)
      setCollections([freshCollection])
      setActiveCollectionId(freshCollection.id)
      clearCollectionLinks(activeCollection.id)
      return
    }

    const currentIndex = collections.findIndex(
      (collection) => collection.id === activeCollection.id,
    )
    const nextCollections = collections.filter(
      (collection) => collection.id !== activeCollection.id,
    )
    const nextActive =
      nextCollections[Math.max(currentIndex - 1, 0)] ?? nextCollections[0]

    setCollections(nextCollections)
    setActiveCollectionId(nextActive.id)
    clearCollectionLinks(activeCollection.id)
  }

  const deleteCollectionById = (collectionId: string) => {
    if (collections.length === 1) {
      const freshCollection = createDefaultCollection(1)
      setCollections([freshCollection])
      setActiveCollectionId(freshCollection.id)
      clearCollectionLinks(collectionId)
      return
    }

    const currentIndex = collections.findIndex(
      (collection) => collection.id === collectionId,
    )

    if (currentIndex === -1) {
      return
    }

    const nextCollections = collections.filter(
      (collection) => collection.id !== collectionId,
    )
    const deletingActive = activeCollectionId === collectionId

    setCollections(nextCollections)

    if (deletingActive) {
      const nextActive =
        nextCollections[Math.max(currentIndex - 1, 0)] ?? nextCollections[0]
      setActiveCollectionId(nextActive.id)
    }

    clearCollectionLinks(collectionId)
  }

  const renameCollectionById = (collectionId: string, name: string) => {
    const trimmed = name.trim()

    if (!trimmed) {
      return
    }

    setCollections((currentCollections) =>
      currentCollections.map((collection) =>
        collection.id === collectionId
          ? { ...collection, name: trimmed }
          : collection,
      ),
    )
  }

  const saveActiveTabToCollection = () => {
    if (!activeTab || !activeCollection) {
      return
    }

    const now = new Date().toISOString()
    const shouldUpdateExisting =
      activeTab.collectionId === activeCollection.id &&
      Boolean(activeTab.savedRequestId) &&
      activeCollection.requests.some(
        (request) => request.id === activeTab.savedRequestId,
      )
    const savedRequestId = shouldUpdateExisting
      ? (activeTab.savedRequestId as string)
      : crypto.randomUUID()
    const baseSavedRequest = createSavedRequestFromTab(
      {
        ...activeTab,
        savedRequestId,
      },
      activeCollection.id,
      now,
    )

    setCollections((currentCollections) =>
      currentCollections.map((collection) => {
        if (collection.id !== activeCollection.id) {
          return collection
        }

        if (shouldUpdateExisting) {
          return {
            ...collection,
            requests: collection.requests.map((request) =>
              request.id === savedRequestId
                ? {
                    ...baseSavedRequest,
                  }
                : request,
            ),
          }
        }

        return {
          ...collection,
          requests: [baseSavedRequest, ...collection.requests],
        }
      }),
    )

    setTabs((currentTabs) =>
      currentTabs.map((tab) =>
        tab.id === activeTab.id
          ? {
              ...tab,
              collectionId: activeCollection.id,
              savedRequestId,
            }
          : tab,
      ),
    )
  }

  const openSavedRequest = (
    collectionId: string,
    savedRequest: SavedRequestItem,
  ) => {
    const existingTab = tabs.find(
      (tab) =>
        tab.collectionId === collectionId &&
        tab.savedRequestId === savedRequest.id,
    )

    if (existingTab) {
      setActiveTabId(existingTab.id)
      return
    }

    const nextTab = createTabFromSavedRequest(savedRequest, collectionId)

    setTabs((currentTabs) => [...currentTabs, nextTab])
    setActiveTabId(nextTab.id)
  }

  const deleteSavedRequest = (collectionId: string, savedRequestId: string) => {
    setCollections((currentCollections) =>
      currentCollections.map((collection) =>
        collection.id === collectionId
          ? {
              ...collection,
              requests: collection.requests.filter(
                (request) => request.id !== savedRequestId,
              ),
            }
          : collection,
      ),
    )

    setTabs((currentTabs) =>
      currentTabs.map((tab) =>
        tab.collectionId === collectionId && tab.savedRequestId === savedRequestId
          ? {
              ...tab,
              collectionId: undefined,
              savedRequestId: undefined,
            }
          : tab,
      ),
    )
  }

  const importCurlIntoActiveTab = () => {
    if (!activeTab) {
      return
    }

    try {
      const importedTab = importCurl(curlImportText, activeTab)

      setTabs((currentTabs) =>
        currentTabs.map((tab) =>
          tab.id === activeTab.id
            ? {
                ...importedTab,
                id: tab.id,
                collectionId: tab.collectionId,
                savedRequestId: tab.savedRequestId,
              }
            : tab,
        ),
      )

      setImportFeedback({
        tone: 'success',
        message: 'cURL importado na aba atual com sucesso.',
      })
    } catch (error) {
      setImportFeedback({
        tone: 'error',
        message:
          error instanceof Error ? error.message : 'Falha ao importar o cURL.',
      })
    }
  }

  const importOpenApiToCollections = () => {
    try {
      const result = importOpenApi(openApiImportText)
      const collectionId = crypto.randomUUID()
      const importedRequests = result.requests.map((request) => {
        const savedRequestId = crypto.randomUUID()

        return createSavedRequestFromTab(
          {
            ...request,
            collectionId,
            savedRequestId,
          },
          collectionId,
          new Date().toISOString(),
        )
      })
      const importedCollection: CollectionItem = {
        id: collectionId,
        name: result.collectionName,
        requests: importedRequests,
      }

      setCollections((currentCollections) => [
        importedCollection,
        ...currentCollections,
      ])
      setActiveCollectionId(collectionId)

      if (importedRequests[0]) {
        const nextTab = createTabFromSavedRequest(importedRequests[0], collectionId)

        setTabs((currentTabs) => [...currentTabs, nextTab])
        setActiveTabId(nextTab.id)
      }

      setImportFeedback({
        tone: 'success',
        message: `OpenAPI importado em "${result.collectionName}" com ${importedRequests.length} request(s).`,
      })
    } catch (error) {
      setImportFeedback({
        tone: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Falha ao importar a especificação OpenAPI.',
      })
    }
  }

  const loadOpenApiFile = async (file?: File) => {
    if (!file) {
      return
    }

    try {
      const text = await file.text()
      setOpenApiImportText(text)
      setImportFeedback({
        tone: 'success',
        message: `Arquivo "${file.name}" carregado para importação.`,
      })
    } catch {
      setImportFeedback({
        tone: 'error',
        message: 'Não foi possível ler o arquivo OpenAPI selecionado.',
      })
    }
  }

  const clearCollectionLinks = (collectionId: string) => {
    setTabs((currentTabs) =>
      currentTabs.map((tab) =>
        tab.collectionId === collectionId
          ? {
              ...tab,
              collectionId: undefined,
              savedRequestId: undefined,
            }
          : tab,
      ),
    )
  }

  const updateLoadTestConfig = (
    key: 'totalRequests' | 'durationSeconds' | 'concurrency',
    value: number,
  ) => {
    setLoadTestConfig((currentConfig) => {
      if (key === 'concurrency') {
        return { ...currentConfig, concurrency: clampNumber(value, 1, 50) }
      }

      if (key === 'durationSeconds') {
        return {
          ...currentConfig,
          durationSeconds: clampNumber(
            value,
            LOAD_TEST_MIN_DURATION_SECONDS,
            LOAD_TEST_MAX_DURATION_SECONDS,
          ),
        }
      }

      return {
        ...currentConfig,
        totalRequests: clampNumber(value, 1, 1000),
      }
    })
  }

  const updateLoadTestMode = (mode: LoadTestMode) => {
    setLoadTestConfig((currentConfig) => ({ ...currentConfig, mode }))
  }

  const sendRequest = async () => {
    if (!activeTab) {
      return
    }

    const requestInput = buildRequestInput(activeTab)
    const unresolvedVariables = collectMissingVariables(
      requestInput,
      activeEnvironment,
    )

    if (unresolvedVariables.length > 0) {
      const missingResponse: RequestResponse = {
        ok: false,
        status: 400,
        statusText: 'Missing Variables',
        durationMs: 0,
        headers: [],
        body: '',
        receivedAt: new Date().toISOString(),
        error: `Defina as variáveis antes de enviar: ${unresolvedVariables.join(', ')}`,
      }

      setTabs((currentTabs) =>
        currentTabs.map((tab) =>
          tab.id === activeTab.id
            ? {
                ...tab,
                response: missingResponse,
                isSending: false,
              }
            : tab,
        ),
      )
      return
    }

    updateActiveTab((tab) => ({ ...tab, isSending: true }))

    const payload = resolveRequestInput(requestInput, activeEnvironment)

    try {
      const response = await executeRequest(payload)
      const nextHistoryEntry = createHistoryEntry(
        activeTab,
        response,
        activeEnvironment,
        payload.url,
      )

      setTabs((currentTabs) =>
        currentTabs.map((tab) =>
          tab.id === activeTab.id
            ? {
                ...tab,
                response,
                isSending: false,
              }
            : tab,
        ),
      )

      setHistory((currentHistory) =>
        [nextHistoryEntry, ...currentHistory].slice(0, HISTORY_LIMIT),
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Falha ao executar request.'
      const fallbackResponse: RequestResponse = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        durationMs: 0,
        headers: [],
        body: '',
        receivedAt: new Date().toISOString(),
        error: message,
      }

      setTabs((currentTabs) =>
        currentTabs.map((tab) =>
          tab.id === activeTab.id
            ? {
                ...tab,
                response: fallbackResponse,
                isSending: false,
              }
            : tab,
        ),
      )
    }
  }

  const executeLoadTestForActiveTab = async () => {
    if (!activeTab) {
      return
    }

    const requestInput = buildRequestInput(activeTab)
    const unresolvedVariables = collectMissingVariables(
      requestInput,
      activeEnvironment,
    )

    if (unresolvedVariables.length > 0) {
      setLoadTestFeedback(
        `Defina as variáveis antes de iniciar a carga: ${unresolvedVariables.join(', ')}`,
      )
      return
    }

    setIsRunningLoadTest(true)
    setLoadTestFeedback(null)
    setLoadTestResult(null)
    setLoadTestLogs([])
    const startMark = performance.now()
    setLoadTestStartedAt(startMark)
    setLoadTestNow(startMark)

    const abortController = new AbortController()
    loadTestAbortRef.current = abortController

    try {
      const payload = resolveRequestInput(requestInput, activeEnvironment)
      const result = await runLoadTest(payload, loadTestConfig, {
        signal: abortController.signal,
        onLog: (entry) => {
          setLoadTestLogs((current) => [...current, entry])
        },
      })
      setLoadTestResult(result)
    } catch (error) {
      setLoadTestFeedback(
        error instanceof Error
          ? error.message
          : 'Falha ao executar o teste de carga.',
      )
    } finally {
      loadTestAbortRef.current = null
      setIsRunningLoadTest(false)
    }
  }

  const stopLoadTest = () => {
    loadTestAbortRef.current?.abort()
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1 className="app-header__main-title">
            <span className="app-header__brand-lockup">
              <BrandFounar />
              {' '}
              <span className="app-header__request-beta">
                <BrandRequest />
                <sup className="eyebrow eyebrow--natural app-header__beta-mark">
                  Beta
                </sup>
              </span>
            </span>
          </h1>
          <p className="subtle">
            <BrandFounarRequest /> para enviar requests HTTP, organizar fluxos e validar APIs
            em um único lugar.
          </p>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          {activeCollection && (
            <section className="panel">
              <CollectionsEditor
                activeCollection={activeCollection}
                collections={collections}
                onAddCollection={addCollection}
                onDelete={deleteActiveCollection}
                onDeleteCollection={deleteCollectionById}
                onDeleteSavedRequest={deleteSavedRequest}
                onOpenSavedRequest={openSavedRequest}
                onRenameCollection={renameCollectionById}
                onSelect={setActiveCollectionId}
              />
            </section>
          )}

          {activeEnvironment && (
            <section className="panel">
              <EnvironmentEditor
                activeEnvironment={activeEnvironment}
                environments={environments}
                onAddEnvironment={addEnvironment}
                onChange={(environment) =>
                  updateActiveEnvironment(() => environment)
                }
                onDelete={deleteActiveEnvironment}
                onSelect={setActiveEnvironmentId}
              />
            </section>
          )}

          <section className="panel">
            <ImportToolsEditor
              curlImportText={curlImportText}
              feedback={importFeedback}
              onCurlImport={importCurlIntoActiveTab}
              onCurlImportTextChange={setCurlImportText}
              onOpenApiFileSelected={loadOpenApiFile}
              onOpenApiImport={importOpenApiToCollections}
              onOpenApiImportTextChange={setOpenApiImportText}
              openApiImportText={openApiImportText}
            />
          </section>

          <div className="sidebar-section">
            <h2>Histórico</h2>
            <p className="subtle">
              Últimas execuções para reabrir ou repetir um fluxo.
            </p>
          </div>

          <div className="history-list">
            {history.length === 0 ? (
              <div className="empty-card">
                As requests executadas vao aparecer aqui.
              </div>
            ) : (
              history.map((entry) => (
                <button
                  className="history-item"
                  key={entry.id}
                  type="button"
                  onClick={() => addTab(entry.tabSnapshot)}
                >
                  <div className="history-item__top">
                    <span className={`method-chip method-chip--${entry.method.toLowerCase()}`}>
                      {entry.method}
                    </span>
                    <span
                      className={`status-pill ${getStatusToneClass(entry.status)}`}
                    >
                      {entry.status}
                    </span>
                  </div>
                  <strong title={entry.url}>{entry.url || 'URL vazia'}</strong>
                  <span className="history-meta">
                    {entry.durationMs} ms · {formatDate(entry.executedAt)}
                    {entry.environmentName ? ` · ${entry.environmentName}` : ''}
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>

        <main className="main-panel">
          <div className="main-panel-strip">
            <div className="tab-strip tab-strip--main">
              {tabs.map((tab) => (
                <div
                  className={`tab-pill ${tab.id === activeTab?.id ? 'is-active' : ''}`}
                  key={tab.id}
                >
                  <button type="button" onClick={() => setActiveTabId(tab.id)}>
                    {tab.name}
                  </button>
                  <span className="tab-pill__close">
                    <button type="button" onClick={() => closeTab(tab.id)}>
                      x
                    </button>
                  </span>
                </div>
              ))}
            </div>

            <div className="main-panel-strip__context request-context request-context--strip">
              <span className="request-context-pill">
                <span className="request-context-pill__label">Environment:{' '}</span>
                <span
                  className={`request-context-pill__value environment-color-text environment-color-text--${activeEnvironment?.color ?? 'branco'}`}
                >
                  {activeEnvironment?.name ?? 'Nenhum'}
                </span>
              </span>
              <span className="request-context-pill">
                <span className="request-context-pill__label">Collection:{' '}</span>
                <span className="request-context-pill__value environment-color-text environment-color-text--branco">
                  {activeCollection?.name ?? 'Nenhuma'}
                </span>
              </span>
            </div>
          </div>

          {activeTab && (
            <>
              <section
                className={`panel request-panel request-panel--env-${activeEnvironment?.color ?? 'branco'}`}
              >
                <div className="request-name-row">
                  <label
                    className="request-name-row__label"
                    htmlFor={`request-name-${activeTab.id}`}
                  >
                    Nome da <BrandRequest />
                  </label>
                  <input
                    id={`request-name-${activeTab.id}`}
                    className="request-name-row__input"
                    type="text"
                    value={activeTab.name}
                    onChange={(event) =>
                      updateActiveTab((tab) => ({
                        ...tab,
                        name: event.target.value,
                      }))
                    }
                  />
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => addTab()}
                  >
                    Nova aba
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => addTab(activeTab)}
                  >
                    Duplicar aba
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={saveActiveTabToCollection}
                    disabled={!activeCollection}
                  >
                    {activeTab.savedRequestId &&
                    activeTab.collectionId === activeCollection?.id ? (
                      <>
                        Atualizar <BrandRequest /> salva
                      </>
                    ) : (
                      <>
                        Salvar <BrandRequest /> na Collection
                      </>
                    )}
                  </button>
                </div>

                {activeTab.savedRequestId && activeTab.collectionId && (
                  <p className="subtle request-saved-hint">
                    Vinculada a uma request salva.
                  </p>
                )}

                <div
                  className={`request-config-panel ${
                    requestConfigTabId === 'body'
                      ? 'request-config-panel--body-active'
                      : ''
                  }`}
                >
                  <div
                    className="request-config-tabs"
                    role="tablist"
                    aria-label="Parâmetros da request"
                  >
                    {REQUEST_CONFIG_TAB_OPTIONS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        role="tab"
                        id={`request-config-tab-${option.id}`}
                        aria-selected={requestConfigTabId === option.id}
                        aria-controls="request-config-tabpanel"
                        className={`request-config-tab ${
                          requestConfigTabId === option.id ? 'is-active' : ''
                        }`}
                        onClick={() => setRequestConfigTabId(option.id)}
                      >
                        {option.id === 'body' ? <BrandRequest /> : option.label}
                      </button>
                    ))}
                  </div>

                  <div
                    id="request-config-tabpanel"
                    role="tabpanel"
                    aria-labelledby={`request-config-tab-${requestConfigTabId}`}
                    className="request-config-tabpanel"
                  >
                    {requestConfigTabId === 'query' && (
                      <KeyValueEditor
                        showTitle={false}
                        title="Query params"
                        rows={activeTab.queryParams}
                        variableNames={variableNames}
                        onChange={(rows) =>
                          updateActiveTab((tab) => ({
                            ...tab,
                            queryParams: rows,
                          }))
                        }
                      />
                    )}

                    {requestConfigTabId === 'auth' && (
                      <AuthEditor
                        auth={activeTab.auth}
                        variableNames={variableNames}
                        onChange={(auth) =>
                          updateActiveTab((tab) => ({
                            ...tab,
                            auth,
                          }))
                        }
                      />
                    )}

                    {requestConfigTabId === 'headers' && (
                      <KeyValueEditor
                        showTitle={false}
                        title="Headers"
                        rows={activeTab.headers}
                        variableNames={variableNames}
                        onChange={(rows) =>
                          updateActiveTab((tab) => ({
                            ...tab,
                            headers: rows,
                          }))
                        }
                      />
                    )}

                    {requestConfigTabId === 'body' && (
                      <div className="request-tab-body-stack">
                        <div className="request-row">
                          <select
                            className="method-select"
                            value={activeTab.method}
                            onChange={(event) =>
                              updateActiveTab((tab) => ({
                                ...tab,
                                method: event.target.value as HttpMethod,
                              }))
                            }
                          >
                            {METHODS.map((method) => (
                              <option key={method} value={method}>
                                {method}
                              </option>
                            ))}
                          </select>

                          <VariableHighlightedInput
                            className="url-input"
                            type="text"
                            placeholder="https://api.exemplo.com/v1/users"
                            value={activeTab.url}
                            variableNames={variableNames}
                            onChange={(event) =>
                              updateActiveTab((tab) => ({
                                ...tab,
                                url: event.target.value,
                              }))
                            }
                          />

                          <button
                            className="primary-button primary-button--compact"
                            type="button"
                            onClick={sendRequest}
                            disabled={activeTab.isSending}
                          >
                            {activeTab.isSending ? 'Enviando...' : 'Enviar request'}
                          </button>
                        </div>

                        {resolvedInput && resolvedInput.url !== activeTab.url && (
                          <div className="request-context">
                            <span className="subtle">
                              URL resolvida: {resolvedInput.url}
                            </span>
                          </div>
                        )}

                        <BodyEditor
                          body={activeTab.body}
                          variableNames={variableNames}
                          onChange={(body) =>
                            updateActiveTab((tab) => ({
                              ...tab,
                              body,
                            }))
                          }
                        />

                        <section className="panel response-panel response-panel--embedded">
                          <div className="response-header">
                            <div>
                              <h2>Resposta</h2>
                              <p className="subtle">
                                Status e resposta da última execução da aba atual.
                              </p>
                            </div>
                            {activeTab.response && (
                              <div className="response-meta">
                                <span
                                  className={`status-pill ${getStatusToneClass(activeTab.response.status)}`}
                                >
                                  {activeTab.response.status}{' '}
                                  {activeTab.response.statusText}
                                </span>
                                <span>{activeTab.response.durationMs} ms</span>
                              </div>
                            )}
                          </div>

                          {activeTab.response ? (
                            <div className="response-body">
                              {activeTab.response.error && (
                                <div className="response-error">
                                  {activeTab.response.error}
                                </div>
                              )}

                              <div className="response-actions">
                                <button
                                  className="ghost-button ghost-button--compact"
                                  type="button"
                                  onClick={() =>
                                    updateActiveTab((tab) => ({
                                      ...tab,
                                      response: undefined,
                                    }))
                                  }
                                >
                                  Limpar resposta
                                </button>
                              </div>

                              <div className="response-section">
                                {activeTab.response.body ? (
                                  isJsonResponse(
                                    activeTab.response.headers,
                                    activeTab.response.body,
                                  ) ? (
                                    <JsonViewer
                                      code={activeTab.response.body}
                                    />
                                  ) : (
                                    <pre>{activeTab.response.body}</pre>
                                  )
                                ) : (
                                  <pre>Resposta sem body.</pre>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="empty-card">
                              Envie uma request para visualizar a resposta aqui.
                            </div>
                          )}
                        </section>
                      </div>
                    )}
                  </div>
                </div>

                {missingVariables.length > 0 && (
                  <div className="warning-banner">
                    Variáveis ausentes: {missingVariables.join(', ')}
                  </div>
                )}
              </section>

              <div className="content-grid content-grid--response-only">
                <div className="stack">
                  <section
                    className={`panel load-test-panel load-test-panel--env-${activeEnvironment?.color ?? 'branco'}`}
                  >
                    <LoadTestEditor
                      config={loadTestConfig}
                      feedback={loadTestFeedback}
                      isRunning={isRunningLoadTest}
                      onChange={updateLoadTestConfig}
                      onModeChange={updateLoadTestMode}
                      onRun={executeLoadTestForActiveTab}
                      onStop={stopLoadTest}
                      result={loadTestResult}
                      logs={loadTestLogs}
                      elapsedMs={
                        loadTestStartedAt != null
                          ? Math.max(0, loadTestNow - loadTestStartedAt)
                          : 0
                      }
                    />
                  </section>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}

type LoadTestEditorProps = {
  config: LoadTestConfig
  result: LoadTestResult | null
  feedback: string | null
  isRunning: boolean
  onRun: () => void
  onStop: () => void
  onChange: (
    key: 'totalRequests' | 'durationSeconds' | 'concurrency',
    value: number,
  ) => void
  onModeChange: (mode: LoadTestMode) => void
  elapsedMs: number
  logs: LoadTestLogEntry[]
}

function LoadTestEditor({
  config,
  result,
  feedback,
  isRunning,
  onRun,
  onStop,
  onChange,
  onModeChange,
  elapsedMs,
  logs,
}: LoadTestEditorProps) {
  const isDurationMode = config.mode === 'duration'
  const targetDurationMs = config.durationSeconds * 1000
  const showLive = isRunning && isDurationMode
  const liveProgress =
    showLive && targetDurationMs > 0
      ? Math.min(100, (elapsedMs / targetDurationMs) * 100)
      : 0

  const chartSamples = showLive ? [] : (result?.samples ?? [])
  const chartElapsedMs = showLive
    ? Math.max(elapsedMs, targetDurationMs)
    : (result?.totalDurationMs ?? 0)
  const chartHasData = chartSamples.length > 0

  const totalSuccess = showLive ? 0 : (result?.successfulRequests ?? 0)
  const totalFailure = showLive ? 0 : (result?.failedRequests ?? 0)
  const totalRequests = totalSuccess + totalFailure
  const successRatio = totalRequests > 0 ? totalSuccess / totalRequests : 0

  return (
    <div className="stack gap-sm">
      <div className="response-header">
        <div>
          <h2>Teste de carga</h2>
          <p className="subtle">
            Execute várias chamadas da request atual com concorrência controlada.
            No modo por tempo a execução roda no servidor até o fim da janela (ou até
            você cancelar).
          </p>
        </div>
        {showLive ? (
          <button
            className="ghost-button"
            type="button"
            onClick={onStop}
          >
            Parar carga
          </button>
        ) : (
          <button
            className="primary-button"
            type="button"
            onClick={onRun}
            disabled={isRunning}
          >
            {isRunning ? 'Executando carga...' : 'Iniciar carga'}
          </button>
        )}
      </div>

      <div className="load-test-mode-toggle" role="tablist" aria-label="Modo do teste de carga">
        <button
          type="button"
          role="tab"
          aria-selected={isDurationMode}
          className={`load-test-mode-toggle__option ${isDurationMode ? 'is-active' : ''}`}
          onClick={() => onModeChange('duration')}
          disabled={isRunning}
        >
          <span>Por tempo</span>
          <ClockIcon className="load-test-mode-toggle__icon" />
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={!isDurationMode}
          className={`load-test-mode-toggle__option ${!isDurationMode ? 'is-active' : ''}`}
          onClick={() => onModeChange('count')}
          disabled={isRunning}
        >
          <span>Por nº de requests</span>
          <PeopleIcon className="load-test-mode-toggle__icon" />
        </button>
      </div>

      <div className="field-grid">
        {isDurationMode ? (
          <label className="field">
            <span>Duração (segundos)</span>
            <input
              type="number"
              min={LOAD_TEST_MIN_DURATION_SECONDS}
              max={LOAD_TEST_MAX_DURATION_SECONDS}
              value={config.durationSeconds}
              onChange={(event) =>
                onChange('durationSeconds', Number(event.target.value || 0))
              }
              disabled={isRunning}
            />
          </label>
        ) : (
          <label className="field">
            <span>Total de requests</span>
            <input
              type="number"
              min={1}
              max={1000}
              value={config.totalRequests}
              onChange={(event) =>
                onChange('totalRequests', Number(event.target.value || 0))
              }
              disabled={isRunning}
            />
          </label>
        )}

        <label className="field">
          <span>Concorrência</span>
          <input
            type="number"
            min={1}
            max={50}
            value={config.concurrency}
            onChange={(event) =>
              onChange('concurrency', Number(event.target.value || 0))
            }
            disabled={isRunning}
          />
        </label>
      </div>

      <p className="subtle helper-text">
        Use com cuidado em APIs reais. Este MVP foi pensado para validação rápida,
        não para testes distribuídos pesados.
      </p>

      {feedback && (
        <div className="import-feedback import-feedback--error">{feedback}</div>
      )}

      {showLive && (
        <div className="load-test-live">
          <div className="load-test-live__header">
            <strong>Em execução no servidor</strong>
            <span className="subtle">
              {formatDuration(elapsedMs)} / {formatDuration(targetDurationMs)}
            </span>
          </div>
          <div
            className="load-test-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(liveProgress)}
          >
            <div
              className="load-test-progress__fill"
              style={{ width: `${liveProgress}%` }}
            />
          </div>
          <p className="subtle load-test-live__hint">
            As métricas e os gráficos são atualizados quando o servidor concluir o
            teste. Use &quot;Parar carga&quot; para cancelar (encerra a conexão e o
            servidor para de agendar novas requests).
          </p>
        </div>
      )}

      {(isRunning || logs.length > 0) && (
        <LoadTestLogPanel logs={logs} isRunning={isRunning} />
      )}

      {(showLive || result) && (
        <div className="load-test-charts">
          <div className="load-test-chart-card">
            <h3>Sucesso x falha</h3>
            <SuccessFailureDonut
              successCount={totalSuccess}
              failureCount={totalFailure}
            />
            <div className="load-test-chart-legend">
              <span className="load-test-chart-legend__item load-test-chart-legend__item--success">
                <span className="load-test-chart-legend__swatch" /> Sucesso{' '}
                <strong>{formatPercent(successRatio)}</strong>
              </span>
              <span className="load-test-chart-legend__item load-test-chart-legend__item--failure">
                <span className="load-test-chart-legend__swatch" /> Falha{' '}
                <strong>{formatPercent(1 - successRatio)}</strong>
              </span>
            </div>
          </div>

          <div className="load-test-chart-card load-test-chart-card--wide">
            <h3>Throughput ao longo do tempo</h3>
            {chartHasData ? (
              <ThroughputChart
                samples={chartSamples}
                elapsedMs={chartElapsedMs}
              />
            ) : (
              <div className="empty-card compact-card">
                {showLive
                  ? 'Aguardando o resultado do servidor...'
                  : 'Aguardando primeiras respostas...'}
              </div>
            )}
          </div>
        </div>
      )}

      {result ? (
        <div className="stack gap-sm">
          <div className="load-test-metrics">
            <div className="metric-card">
              <span className="metric-card__label">Sucesso</span>
              <strong>{result.successfulRequests}</strong>
            </div>
            <div className="metric-card">
              <span className="metric-card__label">Falhas</span>
              <strong>{result.failedRequests}</strong>
            </div>
            <div className="metric-card">
              <span className="metric-card__label">Req/s</span>
              <strong>{formatMetric(result.requestsPerSecond)}</strong>
            </div>
            <div className="metric-card">
              <span className="metric-card__label">Duração</span>
              <strong>{formatDuration(result.totalDurationMs)}</strong>
            </div>
            <div className="metric-card">
              <span className="metric-card__label">P50</span>
              <strong>{result.p50LatencyMs} ms</strong>
            </div>
            <div className="metric-card">
              <span className="metric-card__label">P95</span>
              <strong>{result.p95LatencyMs} ms</strong>
            </div>
          </div>

          <div className="field-grid">
            <div className="metric-inline">
              <span className="metric-card__label">Min / Médio / Max</span>
              <strong>
                {result.minLatencyMs} / {formatMetric(result.avgLatencyMs)} /{' '}
                {result.maxLatencyMs} ms
              </strong>
            </div>
            <div className="metric-inline">
              <span className="metric-card__label">Executado em</span>
              <strong>{formatDate(result.startedAt)}</strong>
            </div>
          </div>

          <div className="response-section">
            <h3>Status retornados</h3>
            <div className="status-counts">
              {result.statusCounts.map((statusCount) => (
                <div className="status-count-chip" key={statusCount.label}>
                  <span>{statusCount.label}</span>
                  <strong>{statusCount.count}</strong>
                </div>
              ))}
            </div>
          </div>

          {result.errorSamples.length > 0 && (
            <div className="response-section">
              <h3>Erros observados</h3>
              <div className="error-sample-list">
                {result.errorSamples.map((errorSample) => (
                  <div className="response-error" key={errorSample}>
                    {errorSample}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        !showLive && (
          <div className="empty-card compact-card">
            Execute um teste para visualizar throughput, latências e a proporção
            de sucesso.
          </div>
        )
      )}
    </div>
  )
}

type IconProps = {
  className?: string
}

function ClockIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

function PeopleIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.6 19c.6-2.8 3.2-4.6 6.4-4.6s5.8 1.8 6.4 4.6" />
      <circle cx="17" cy="9" r="2.6" />
      <path d="M15.8 14.6c2.6.4 4.6 2 5.2 4.4" />
    </svg>
  )
}

type SuccessFailureDonutProps = {
  successCount: number
  failureCount: number
}

function SuccessFailureDonut({
  successCount,
  failureCount,
}: SuccessFailureDonutProps) {
  const total = successCount + failureCount
  const size = 140
  const stroke = 18
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const successRatio = total > 0 ? successCount / total : 0
  const successLength = circumference * successRatio
  const failureLength = circumference - successLength

  return (
    <svg
      className="load-test-donut"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Sucesso ${formatPercent(successRatio)} e falha ${formatPercent(1 - successRatio)}`}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={stroke}
      />
      {total > 0 && (
        <>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--load-test-success, #4ade80)"
            strokeWidth={stroke}
            strokeDasharray={`${successLength} ${circumference}`}
            strokeDashoffset={circumference / 4}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            strokeLinecap="butt"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--load-test-failure, #f87171)"
            strokeWidth={stroke}
            strokeDasharray={`${failureLength} ${circumference}`}
            strokeDashoffset={circumference / 4 - successLength}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            strokeLinecap="butt"
          />
        </>
      )}
      <text
        x="50%"
        y="48%"
        textAnchor="middle"
        className="load-test-donut__value"
      >
        {formatPercent(successRatio)}
      </text>
      <text
        x="50%"
        y="64%"
        textAnchor="middle"
        className="load-test-donut__caption"
      >
        sucesso
      </text>
    </svg>
  )
}

type ThroughputChartProps = {
  samples: LoadTestSample[]
  elapsedMs: number
}

function ThroughputChart({ samples, elapsedMs }: ThroughputChartProps) {
  const width = 520
  const height = 160
  const padding = { top: 12, right: 12, bottom: 22, left: 28 }
  const innerWidth = width - padding.left - padding.right
  const innerHeight = height - padding.top - padding.bottom

  const totalMs = Math.max(elapsedMs, 1000)
  const bucketCount = Math.min(60, Math.max(6, Math.round(totalMs / 1000)))
  const bucketMs = totalMs / bucketCount

  const buckets = Array.from({ length: bucketCount }, () => ({
    success: 0,
    failure: 0,
  }))

  for (const sample of samples) {
    const index = Math.min(
      bucketCount - 1,
      Math.max(0, Math.floor(sample.elapsedMs / bucketMs)),
    )
    if (sample.ok) {
      buckets[index].success += 1
    } else {
      buckets[index].failure += 1
    }
  }

  const maxValue = Math.max(
    1,
    ...buckets.map((bucket) => bucket.success + bucket.failure),
  )
  const barWidth = innerWidth / bucketCount

  return (
    <svg
      className="load-test-throughput"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Throughput de requests ao longo do tempo, por segundo"
    >
      <line
        x1={padding.left}
        y1={padding.top + innerHeight}
        x2={padding.left + innerWidth}
        y2={padding.top + innerHeight}
        stroke="rgba(255,255,255,0.15)"
      />
      <line
        x1={padding.left}
        y1={padding.top}
        x2={padding.left}
        y2={padding.top + innerHeight}
        stroke="rgba(255,255,255,0.15)"
      />

      <text
        x={padding.left - 6}
        y={padding.top + 4}
        textAnchor="end"
        className="load-test-throughput__axis"
      >
        {maxValue}
      </text>
      <text
        x={padding.left - 6}
        y={padding.top + innerHeight}
        textAnchor="end"
        className="load-test-throughput__axis"
      >
        0
      </text>
      <text
        x={padding.left}
        y={height - 6}
        textAnchor="start"
        className="load-test-throughput__axis"
      >
        0s
      </text>
      <text
        x={padding.left + innerWidth}
        y={height - 6}
        textAnchor="end"
        className="load-test-throughput__axis"
      >
        {formatDuration(totalMs)}
      </text>

      {buckets.map((bucket, index) => {
        const total = bucket.success + bucket.failure
        if (total === 0) {
          return null
        }

        const x = padding.left + index * barWidth
        const failureHeight = (bucket.failure / maxValue) * innerHeight
        const successHeight = (bucket.success / maxValue) * innerHeight
        const failureY = padding.top + innerHeight - failureHeight
        const successY = failureY - successHeight
        const gap = barWidth > 4 ? 1.5 : 0

        return (
          <g key={`bucket-${index}`}>
            {bucket.success > 0 && (
              <rect
                x={x + gap / 2}
                y={successY}
                width={Math.max(1, barWidth - gap)}
                height={Math.max(1, successHeight)}
                fill="var(--load-test-success, #4ade80)"
                rx={1.5}
              />
            )}
            {bucket.failure > 0 && (
              <rect
                x={x + gap / 2}
                y={failureY}
                width={Math.max(1, barWidth - gap)}
                height={Math.max(1, failureHeight)}
                fill="var(--load-test-failure, #f87171)"
                rx={1.5}
              />
            )}
          </g>
        )
      })}
    </svg>
  )
}

type LoadTestLogPanelProps = {
  logs: LoadTestLogEntry[]
  isRunning: boolean
}

const LOAD_TEST_LOG_STICK_THRESHOLD_PX = 48

function LoadTestLogPanel({ logs, isRunning }: LoadTestLogPanelProps) {
  const listRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)
  const programmaticScrollRef = useRef(false)

  const handleScroll = () => {
    if (programmaticScrollRef.current) {
      programmaticScrollRef.current = false
      return
    }
    const element = listRef.current
    if (!element) {
      return
    }
    const distanceFromBottom =
      element.scrollHeight - (element.scrollTop + element.clientHeight)
    stickToBottomRef.current =
      distanceFromBottom < LOAD_TEST_LOG_STICK_THRESHOLD_PX
  }

  useLayoutEffect(() => {
    const element = listRef.current
    if (!element) {
      return
    }
    if (stickToBottomRef.current) {
      programmaticScrollRef.current = true
      element.scrollTop = element.scrollHeight
    }
  }, [logs.length])

  return (
    <div className="load-test-logs">
      <div className="load-test-logs__header">
        <strong>Logs das chamadas</strong>
        <span className="subtle">
          {isRunning
            ? `Acompanhando em tempo real · ${logs.length} chamada${logs.length === 1 ? '' : 's'}`
            : `${logs.length} chamada${logs.length === 1 ? '' : 's'} registrada${logs.length === 1 ? '' : 's'}`}
        </span>
      </div>
      <div
        ref={listRef}
        className="load-test-logs__list"
        role="log"
        aria-live="polite"
        onScroll={handleScroll}
      >
        {logs.length === 0 ? (
          <div className="load-test-logs__empty">
            Aguardando primeiras respostas...
          </div>
        ) : (
          logs.map((entry) => (
            <div
              className="load-test-logs__entry"
              key={`${entry.index}-${entry.url}`}
            >
              <span className="load-test-logs__seq">#{entry.index + 1}</span>
              <span
                className={`load-test-logs__status load-test-logs__status--${getLogStatusTone(entry)}`}
              >
                {entry.status > 0 ? entry.status : 'ERR'}
              </span>
              <span className="load-test-logs__method">{entry.method}</span>
              <span className="load-test-logs__url" title={entry.url}>
                {entry.url}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function getLogStatusTone(entry: LoadTestLogEntry) {
  if (!entry.ok || entry.error) {
    return 'error'
  }

  if (entry.status >= 200 && entry.status < 300) {
    return 'success'
  }

  if (entry.status >= 300 && entry.status < 400) {
    return 'info'
  }

  return 'error'
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) {
    return '0s'
  }

  const totalSeconds = Math.round(ms / 100) / 10

  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(totalSeconds >= 10 ? 0 : 1)}s`
  }

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.round(totalSeconds - minutes * 60)
  return `${minutes}m ${seconds}s`
}

function formatPercent(ratio: number) {
  if (!Number.isFinite(ratio)) {
    return '0%'
  }

  return `${(ratio * 100).toFixed(ratio === 0 || ratio === 1 ? 0 : 1)}%`
}

type AuthEditorProps = {
  auth: AuthConfig
  onChange: (auth: AuthConfig) => void
  variableNames: ReadonlySet<string>
}

function AuthEditor({ auth, onChange, variableNames }: AuthEditorProps) {
  return (
    <div className="stack gap-sm">
      <label className="field">
        <span>Tipo</span>
        <select
          value={auth.type}
          onChange={(event) => {
            const nextType = event.target.value as AuthConfig['type']

            if (nextType === 'bearer') {
              onChange({ type: 'bearer', token: '' })
              return
            }

            if (nextType === 'basic') {
              onChange({ type: 'basic', username: '', password: '' })
              return
            }

            if (nextType === 'apiKey') {
              onChange({ type: 'apiKey', key: '', value: '', addTo: 'header' })
              return
            }

            onChange({ type: 'none' })
          }}
        >
          <option value="none">Sem auth</option>
          <option value="bearer">Bearer token</option>
          <option value="basic">Basic auth</option>
          <option value="apiKey">API key</option>
        </select>
      </label>

      {auth.type === 'bearer' && (
        <label className="field">
          <span>Token</span>
          <input
            type="password"
            value={auth.token}
            onChange={(event) =>
              onChange({ ...auth, token: event.target.value })
            }
          />
        </label>
      )}

      {auth.type === 'basic' && (
        <div className="field-grid">
          <label className="field">
            <span>Usuário</span>
            <VariableHighlightedInput
              type="text"
              value={auth.username}
              variableNames={variableNames}
              onChange={(event) =>
                onChange({ ...auth, username: event.target.value })
              }
            />
          </label>
          <label className="field">
            <span>Senha</span>
            <input
              type="password"
              value={auth.password}
              onChange={(event) =>
                onChange({ ...auth, password: event.target.value })
              }
            />
          </label>
        </div>
      )}

      {auth.type === 'apiKey' && (
        <div className="field-grid">
          <label className="field">
            <span>Chave</span>
            <VariableHighlightedInput
              type="text"
              value={auth.key}
              variableNames={variableNames}
              onChange={(event) => onChange({ ...auth, key: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Valor</span>
            <input
              type="password"
              value={auth.value}
              onChange={(event) =>
                onChange({ ...auth, value: event.target.value })
              }
            />
          </label>
          <label className="field">
            <span>Adicionar em</span>
            <select
              value={auth.addTo}
              onChange={(event) =>
                onChange({
                  ...auth,
                  addTo: event.target.value as 'header' | 'query',
                })
              }
            >
              <option value="header">Header</option>
              <option value="query">Query param</option>
            </select>
          </label>
        </div>
      )}
    </div>
  )
}

type BodyEditorProps = {
  body: RequestBody
  onChange: (body: RequestBody) => void
  variableNames: ReadonlySet<string>
}

function BodyEditor({ body, onChange, variableNames }: BodyEditorProps) {
  return (
    <div className="stack gap-sm">
      <label className="field">
        <span>Modo</span>
        <select
          value={body.mode}
          onChange={(event) => {
            const mode = event.target.value as RequestBody['mode']

            if (mode === 'json' || mode === 'text') {
              onChange({ mode, content: '' })
              return
            }

            if (mode === 'form') {
              onChange({ mode: 'form', entries: [createRow()] })
              return
            }

            onChange({ mode: 'none' })
          }}
        >
          <option value="none">Sem body</option>
          <option value="json">JSON</option>
          <option value="text">Texto</option>
          <option value="form">Form URL Encoded</option>
        </select>
      </label>

      {body.mode === 'json' && (
        <div className="field">
          <div className="json-body-header">
            <span>Conteúdo</span>
            <div className="json-body-actions">
              <JsonValidityIndicator content={body.content} />
              <button
                className="ghost-button ghost-button--compact"
                type="button"
                onClick={() => {
                  const result = formatJsonWithVariables(body.content)
                  if (result.ok) {
                    onChange({ ...body, content: result.value })
                  }
                }}
              >
                Formatar JSON
              </button>
            </div>
          </div>
          <VariableHighlightedTextarea
            rows={12}
            value={body.content}
            variableNames={variableNames}
            language="json"
            withLineNumbers
            onChange={(event) =>
              onChange({ ...body, content: event.target.value })
            }
          />
        </div>
      )}

      {body.mode === 'text' && (
        <label className="field">
          <span>Conteúdo</span>
          <VariableHighlightedTextarea
            rows={12}
            value={body.content}
            variableNames={variableNames}
            onChange={(event) =>
              onChange({ ...body, content: event.target.value })
            }
          />
        </label>
      )}

      {body.mode === 'form' && (
        <KeyValueEditor
          title="Campos"
          rows={body.entries}
          variableNames={variableNames}
          onChange={(rows) => onChange({ mode: 'form', entries: rows })}
        />
      )}
    </div>
  )
}

function JsonValidityIndicator({ content }: { content: string }) {
  const trimmed = content.trim()

  if (!trimmed) {
    return null
  }

  const valid = isJsonValid(content)

  return (
    <span
      className={`json-validity json-validity--${valid ? 'ok' : 'error'}`}
      title={valid ? 'JSON válido' : 'JSON inválido'}
    >
      <span className="json-validity__dot" />
      {valid ? 'JSON válido' : 'JSON inválido'}
    </span>
  )
}

type KeyValueEditorProps = {
  title: string
  rows: KeyValueRow[]
  onChange: (rows: KeyValueRow[]) => void
  variableNames: ReadonlySet<string>
  showTitle?: boolean
}

function KeyValueEditor({
  title,
  rows,
  onChange,
  variableNames,
  showTitle = true,
}: KeyValueEditorProps) {
  return (
    <div className="stack gap-sm">
      {showTitle ? (
        <div className="section-heading">
          <h2>{title}</h2>
          <button
            className="ghost-button"
            type="button"
            onClick={() => onChange([...rows, createRow()])}
          >
            Adicionar
          </button>
        </div>
      ) : (
        <div className="kv-editor-toolbar">
          <span className="sr-only">{title}</span>
          <button
            className="ghost-button"
            type="button"
            onClick={() => onChange([...rows, createRow()])}
          >
            Adicionar
          </button>
        </div>
      )}

      <div className="kv-list">
        {rows.map((row) => (
          <div className="kv-row" key={row.id}>
            <label className="toggle">
              <input
                type="checkbox"
                checked={row.enabled}
                onChange={(event) =>
                  onChange(
                    rows.map((current) =>
                      current.id === row.id
                        ? { ...current, enabled: event.target.checked }
                        : current,
                    ),
                  )
                }
              />
              <span>Ativo</span>
            </label>

            <VariableHighlightedInput
              type="text"
              placeholder="chave"
              value={row.key}
              variableNames={variableNames}
              onChange={(event) =>
                onChange(
                  rows.map((current) =>
                    current.id === row.id
                      ? { ...current, key: event.target.value }
                      : current,
                  ),
                )
              }
            />
            <VariableHighlightedInput
              type="text"
              placeholder="valor"
              value={row.value}
              variableNames={variableNames}
              onChange={(event) =>
                onChange(
                  rows.map((current) =>
                    current.id === row.id
                      ? { ...current, value: event.target.value }
                      : current,
                  ),
                )
              }
            />
            <button
              className="danger-button"
              type="button"
              onClick={() => {
                const nextRows = rows.filter((current) => current.id !== row.id)
                onChange(nextRows.length === 0 ? [createRow()] : nextRows)
              }}
            >
              Remover
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

type EnvironmentFormModalState =
  | {
      mode: 'create'
      name: string
      color: EnvironmentColor
      openKey: number
    }
  | {
      mode: 'edit'
      name: string
      color: EnvironmentColor
      openKey: number
    }

type EnvironmentEditorProps = {
  environments: EnvironmentItem[]
  activeEnvironment: EnvironmentItem
  onAddEnvironment: (name: string, color: EnvironmentColor) => void
  onChange: (environment: EnvironmentItem) => void
  onDelete: () => void
  onSelect: (environmentId: string) => void
}

function EnvironmentEditor({
  environments,
  activeEnvironment,
  onAddEnvironment,
  onChange,
  onDelete,
  onSelect,
}: EnvironmentEditorProps) {
  const envModalOpenSeq = useRef(0)
  const environmentModalNameInputRef = useRef<HTMLInputElement | null>(null)
  const [environmentModal, setEnvironmentModal] =
    useState<EnvironmentFormModalState | null>(null)

  const environmentModalFocusKey =
    environmentModal == null
      ? null
      : environmentModal.mode === 'create'
        ? `env-c:${environmentModal.openKey}`
        : `env-e:${activeEnvironment.id}:${environmentModal.openKey}`

  useEffect(() => {
    setEnvironmentModal((current) =>
      current?.mode === 'edit' ? null : current,
    )
  }, [activeEnvironment.id])

  useEffect(() => {
    if (!environmentModal) {
      return
    }

    const t = window.setTimeout(() => {
      environmentModalNameInputRef.current?.focus()
      environmentModalNameInputRef.current?.select()
    }, 0)

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setEnvironmentModal(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.clearTimeout(t)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [environmentModalFocusKey])

  return (
    <div className="stack gap-sm">
      <div className="environments-block-heading">
        <h2 className="environments-block-heading__title">Environments</h2>
        <div className="environments-block-heading__actions">
          <button
            className="ghost-button ghost-button--compact"
            type="button"
            onClick={() => {
              envModalOpenSeq.current += 1
              const index = environments.length + 1

              setEnvironmentModal({
                mode: 'create',
                name: index === 1 ? 'Default' : `Environment ${index}`,
                color: 'branco',
                openKey: envModalOpenSeq.current,
              })
            }}
          >
            Novo
          </button>
          <button
            className="ghost-button ghost-button--compact"
            type="button"
            onClick={() => {
              envModalOpenSeq.current += 1

              setEnvironmentModal({
                mode: 'edit',
                name: activeEnvironment.name,
                color: activeEnvironment.color,
                openKey: envModalOpenSeq.current,
              })
            }}
          >
            Editar
          </button>
          <button
            className="danger-button danger-button--compact"
            type="button"
            onClick={onDelete}
          >
            Excluir
          </button>
        </div>
      </div>

      <label className="field" htmlFor="environment-active-select">
        <span>Selecionado</span>
        <select
          id="environment-active-select"
          className="environment-active-select environment-color-select"
          style={{
            color: ENVIRONMENT_COLOR_CSS[activeEnvironment.color],
          }}
          value={activeEnvironment.id}
          onChange={(event) => onSelect(event.target.value)}
        >
          {environments.map((environment) => (
            <option
              key={environment.id}
              value={environment.id}
              style={{ color: ENVIRONMENT_COLOR_CSS[environment.color] }}
            >
              {environment.name}
            </option>
          ))}
        </select>
      </label>

      <p className="subtle helper-text environments-block-helper-text">
        Use variáveis com o formato <code>{'{{variável}}'}</code> em URL, headers,
        body e auth.
      </p>

      <EnvironmentVariablesEditor
        rows={activeEnvironment.variables}
        onChange={(rows) =>
          onChange({
            ...activeEnvironment,
            variables: rows,
          })
        }
      />

      {environmentModal &&
        createPortal(
          <div
            className="collections-rename-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setEnvironmentModal(null)
              }
            }}
          >
            <div
              className="collections-rename-dialog"
              role="dialog"
              aria-labelledby="environment-modal-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <h3 id="environment-modal-title">
                {environmentModal.mode === 'create'
                  ? 'Novo environment'
                  : 'Editar environment'}
              </h3>
              <label className="field">
                <span>Nome</span>
                <input
                  ref={environmentModalNameInputRef}
                  type="text"
                  value={environmentModal.name}
                  onChange={(event) =>
                    setEnvironmentModal((current) =>
                      current
                        ? { ...current, name: event.target.value }
                        : current,
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') {
                      return
                    }

                    event.preventDefault()
                    const trimmed = environmentModal.name.trim()

                    if (!trimmed) {
                      return
                    }

                    if (environmentModal.mode === 'create') {
                      onAddEnvironment(trimmed, environmentModal.color)
                    } else {
                      onChange({
                        ...activeEnvironment,
                        name: trimmed,
                        color: environmentModal.color,
                      })
                    }

                    setEnvironmentModal(null)
                  }}
                />
              </label>
              <label className="field">
                <span>Cor do ambiente</span>
                <select
                  className="environment-color-select"
                  style={{
                    color: ENVIRONMENT_COLOR_CSS[environmentModal.color],
                  }}
                  value={environmentModal.color}
                  onChange={(event) =>
                    setEnvironmentModal((current) =>
                      current
                        ? {
                            ...current,
                            color: event.target.value as EnvironmentColor,
                          }
                        : current,
                    )
                  }
                >
                  {ENVIRONMENT_COLOR_OPTIONS.map((option) => (
                    <option
                      key={option.value}
                      value={option.value}
                      className={`environment-color-text environment-color-text--${option.value}`}
                      style={{ color: ENVIRONMENT_COLOR_CSS[option.value] }}
                    >
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="field-preview">
                  Cor selecionada:{' '}
                  <span
                    className={`environment-color-text environment-color-text--${environmentModal.color}`}
                  >
                    {getEnvironmentColorLabel(environmentModal.color)}
                  </span>
                </span>
              </label>
              <div className="collections-rename-dialog__actions">
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => setEnvironmentModal(null)}
                >
                  Cancelar
                </button>
                <button
                  className="primary-button"
                  type="button"
                  disabled={!environmentModal.name.trim()}
                  onClick={() => {
                    const trimmed = environmentModal.name.trim()

                    if (!trimmed) {
                      return
                    }

                    if (environmentModal.mode === 'create') {
                      onAddEnvironment(trimmed, environmentModal.color)
                    } else {
                      onChange({
                        ...activeEnvironment,
                        name: trimmed,
                        color: environmentModal.color,
                      })
                    }

                    setEnvironmentModal(null)
                  }}
                >
                  Salvar
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}

type CollectionNameModalState =
  | {
      mode: 'rename'
      collectionId: string
      name: string
    }
  | {
      mode: 'create'
      name: string
      openKey: number
    }

type CollectionsEditorProps = {
  collections: CollectionItem[]
  activeCollection: CollectionItem
  onAddCollection: (name: string) => void
  onDelete: () => void
  onDeleteCollection: (collectionId: string) => void
  onRenameCollection: (collectionId: string, name: string) => void
  onOpenSavedRequest: (collectionId: string, savedRequest: SavedRequestItem) => void
  onDeleteSavedRequest: (collectionId: string, savedRequestId: string) => void
  onSelect: (collectionId: string) => void
}

function CollectionsEditor({
  collections,
  activeCollection,
  onSelect,
  onAddCollection,
  onDelete,
  onDeleteCollection,
  onRenameCollection,
  onOpenSavedRequest,
  onDeleteSavedRequest,
}: CollectionsEditorProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const newCollectionOpenSeq = useRef(0)
  const [contextMenu, setContextMenu] = useState<{
    collectionId: string
    clientX: number
    clientY: number
  } | null>(null)
  const [sublistExpanded, setSublistExpanded] = useState(true)
  const [nameModal, setNameModal] = useState<CollectionNameModalState | null>(
    null,
  )

  useEffect(() => {
    setSublistExpanded(true)
  }, [activeCollection.id])

  const nameModalFocusKey =
    nameModal == null
      ? null
      : nameModal.mode === 'rename'
        ? `r:${nameModal.collectionId}`
        : `c:${nameModal.openKey}`

  useEffect(() => {
    if (!nameModal) {
      return
    }

    const t = window.setTimeout(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    }, 0)

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setNameModal(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.clearTimeout(t)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [nameModalFocusKey])

  useEffect(() => {
    if (!contextMenu) {
      return
    }

    const handlePointerDown = (event: Event) => {
      const target = event.target as Node | null

      if (menuRef.current && target && !menuRef.current.contains(target)) {
        setContextMenu(null)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [contextMenu])

  const openContextMenu = (event: MouseEvent, collectionId: string) => {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({
      collectionId,
      clientX: event.clientX,
      clientY: event.clientY,
    })
  }

  const contextCollection = contextMenu
    ? collections.find((c) => c.id === contextMenu.collectionId)
    : undefined

  const menuLeft = contextMenu
    ? Math.max(
        8,
        Math.min(
          contextMenu.clientX,
          typeof window !== 'undefined'
            ? window.innerWidth - 172
            : contextMenu.clientX,
        ),
      )
    : 0

  const menuTop = contextMenu
    ? Math.max(
        8,
        Math.min(
          contextMenu.clientY,
          typeof window !== 'undefined'
            ? window.innerHeight - 88
            : contextMenu.clientY,
        ),
      )
    : 0

  return (
    <div className="stack gap-sm">
      <div className="collections-block-heading">
        <h2 className="collections-block-heading__title">Collections</h2>
        <div className="collections-block-heading__actions">
          <button
            className="ghost-button ghost-button--compact"
            type="button"
            onClick={() => {
              newCollectionOpenSeq.current += 1
              const index = collections.length + 1

              setNameModal({
                mode: 'create',
                name:
                  index === 1 ? 'Minha Collection' : `Collection ${index}`,
                openKey: newCollectionOpenSeq.current,
              })
            }}
          >
            Nova
          </button>
          <button
            className="ghost-button ghost-button--compact"
            type="button"
            onClick={() => {
              setNameModal({
                mode: 'rename',
                collectionId: activeCollection.id,
                name: activeCollection.name,
              })
            }}
          >
            Renomear
          </button>
          <button
            className="danger-button danger-button--compact"
            type="button"
            onClick={onDelete}
          >
            Excluir
          </button>
        </div>
      </div>

      <nav
        className="collections-folder-list"
        aria-label="Lista de collections e requests salvas"
      >
        {collections.map((collection) => {
          const isActive = collection.id === activeCollection.id

          return (
            <div key={collection.id} className="collections-folder-branch">
              <button
                type="button"
                className={`collections-folder-item ${
                  isActive ? 'is-active' : ''
                }`}
                aria-expanded={isActive ? sublistExpanded : false}
                onClick={() => {
                  if (collection.id === activeCollection.id) {
                    setSublistExpanded((open) => !open)
                  } else {
                    onSelect(collection.id)
                  }
                }}
                onContextMenu={(event) => openContextMenu(event, collection.id)}
              >
                <span className="collections-folder-item__label">
                  {collection.name}
                </span>
                {collection.requests.length > 0 && (
                  <span className="collections-folder-item__count subtle">
                    {collection.requests.length}
                  </span>
                )}
              </button>

              <div
                className={`collections-folder-sublist-wrap${
                  isActive && sublistExpanded
                    ? ' collections-folder-sublist-wrap--open'
                    : ''
                }`}
                aria-hidden={!isActive || !sublistExpanded}
              >
                <div className="collections-folder-sublist-inner">
                  {isActive && (
                    <div
                      className="collections-folder-sublist"
                      role="group"
                      aria-label={`Requests salvas em ${collection.name}`}
                    >
                      {collection.requests.length === 0 ? (
                        <p className="collections-folder-sublist__empty subtle">
                          Nenhuma request salva nesta collection.
                        </p>
                      ) : (
                        collection.requests.map((savedRequest, requestIndex) => (
                          <div
                            className="saved-request-card saved-request-card--nested"
                            key={savedRequest.id}
                            style={
                              {
                                '--saved-card-delay': `${requestIndex * 48}ms`,
                              } as CSSProperties
                            }
                          >
                            <button
                              className="saved-request-card__content"
                              type="button"
                              title={
                                savedRequest.request.url
                                  ? `${savedRequest.name} — ${savedRequest.request.url}`
                                  : savedRequest.name
                              }
                              onClick={() =>
                                onOpenSavedRequest(collection.id, savedRequest)
                              }
                            >
                              <div className="saved-request-card__row-head">
                                <span
                                  className={`method-chip method-chip--nested method-chip--${savedRequest.request.method.toLowerCase()}`}
                                >
                                  {savedRequest.request.method}
                                </span>
                                <strong className="saved-request-card__name">
                                  {savedRequest.name}
                                </strong>
                              </div>
                              <div className="saved-request-card__meta">
                                <span className="saved-request-card__date-label">
                                  Modificada em
                                </span>
                                <span className="saved-request-card__date-value">
                                  {formatSavedListDate(savedRequest.updatedAt)}
                                </span>
                              </div>
                            </button>

                            <button
                              className="danger-button danger-button--nested"
                              type="button"
                              onClick={() =>
                                onDeleteSavedRequest(
                                  collection.id,
                                  savedRequest.id,
                                )
                              }
                            >
                              Excluir
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </nav>

      {contextMenu &&
        contextCollection &&
        createPortal(
          <div
            ref={menuRef}
            className="collections-context-menu"
            role="menu"
            style={{ left: menuLeft, top: menuTop }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              className="collections-context-menu__item"
              role="menuitem"
              type="button"
              onClick={() => {
                setNameModal({
                  mode: 'rename',
                  collectionId: contextMenu.collectionId,
                  name: contextCollection.name,
                })
                setContextMenu(null)
              }}
            >
              Renomear
            </button>
            <button
              className="collections-context-menu__item collections-context-menu__item--danger"
              role="menuitem"
              type="button"
              onClick={() => {
                const ok = window.confirm(
                  `Excluir a collection "${contextCollection.name}"? As requests salvas nesta collection serão removidas.`,
                )

                if (ok) {
                  onDeleteCollection(contextMenu.collectionId)
                }

                setContextMenu(null)
              }}
            >
              Excluir collection
            </button>
          </div>,
          document.body,
        )}

      {nameModal &&
        createPortal(
          <div
            className="collections-rename-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setNameModal(null)
              }
            }}
          >
            <div
              className="collections-rename-dialog"
              role="dialog"
              aria-labelledby="collections-name-modal-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <h3 id="collections-name-modal-title">
                {nameModal.mode === 'rename'
                  ? 'Renomear collection'
                  : 'Nova collection'}
              </h3>
              <label className="field">
                <span>Nome</span>
                <input
                  ref={renameInputRef}
                  type="text"
                  value={nameModal.name}
                  onChange={(event) =>
                    setNameModal((current) =>
                      current ? { ...current, name: event.target.value } : current,
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') {
                      return
                    }

                    event.preventDefault()
                    const trimmed = nameModal.name.trim()

                    if (!trimmed) {
                      return
                    }

                    if (nameModal.mode === 'rename') {
                      onRenameCollection(nameModal.collectionId, trimmed)
                    } else {
                      onAddCollection(trimmed)
                    }

                    setNameModal(null)
                  }}
                />
              </label>
              <div className="collections-rename-dialog__actions">
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => setNameModal(null)}
                >
                  Cancelar
                </button>
                <button
                  className="primary-button"
                  type="button"
                  disabled={!nameModal.name.trim()}
                  onClick={() => {
                    const trimmed = nameModal.name.trim()

                    if (!trimmed) {
                      return
                    }

                    if (nameModal.mode === 'rename') {
                      onRenameCollection(nameModal.collectionId, trimmed)
                    } else {
                      onAddCollection(trimmed)
                    }

                    setNameModal(null)
                  }}
                >
                  Salvar
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}

type ImportToolsEditorProps = {
  curlImportText: string
  openApiImportText: string
  feedback: {
    tone: 'success' | 'error'
    message: string
  } | null
  onCurlImportTextChange: (value: string) => void
  onOpenApiImportTextChange: (value: string) => void
  onCurlImport: () => void
  onOpenApiImport: () => void
  onOpenApiFileSelected: (file?: File) => Promise<void>
}

function ImportToolsEditor({
  curlImportText,
  openApiImportText,
  feedback,
  onCurlImportTextChange,
  onOpenApiImportTextChange,
  onCurlImport,
  onOpenApiImport,
  onOpenApiFileSelected,
}: ImportToolsEditorProps) {
  return (
    <div className="stack gap-sm">
      <div className="import-tools-heading">
        <h2 className="import-tools-heading__title">Importação</h2>
      </div>

      {feedback && (
        <div
          className={`import-feedback import-feedback--${feedback.tone}`}
        >
          {feedback.message}
        </div>
      )}

      <div className="import-block">
        <div>
          <div className="section-heading">
            <h2>Importar cURL</h2>
          </div>
          <p className="subtle helper-text">
            Cole um comando cURL para preencher a aba atual.
          </p>
        </div>

        <label className="field">
          <span>Comando cURL</span>
          <textarea
            rows={5}
            placeholder='curl -X GET "https://api.exemplo.com/users" -H "Authorization: Bearer token"'
            value={curlImportText}
            onChange={(event) => onCurlImportTextChange(event.target.value)}
          />
        </label>

        <button
          className="ghost-button ghost-button--import-curl"
          type="button"
          onClick={onCurlImport}
        >
          Importar cURL na aba atual
        </button>
      </div>

      <div className="import-block">
        <div>
          <div className="section-heading">
            <h2>Importar OpenAPI</h2>
          </div>
          <p className="subtle helper-text">
            Cole JSON/YAML ou carregue um arquivo para gerar uma nova collection.
          </p>
        </div>

        <label className="field">
          <span>Conteúdo OpenAPI</span>
          <textarea
            rows={8}
            placeholder="openapi: 3.0.0"
            value={openApiImportText}
            onChange={(event) => onOpenApiImportTextChange(event.target.value)}
          />
        </label>

        <label className="field">
          <span>Arquivo da especificação</span>
          <input
            type="file"
            accept=".json,.yaml,.yml,application/json,text/yaml,text/x-yaml"
            onChange={(event) => void onOpenApiFileSelected(event.target.files?.[0])}
          />
        </label>

        <button
          className="ghost-button ghost-button--import-openapi"
          type="button"
          onClick={onOpenApiImport}
        >
          Importar OpenAPI em nova collection
        </button>
      </div>
    </div>
  )
}

type EnvironmentVariablesEditorProps = {
  rows: KeyValueRow[]
  onChange: (rows: KeyValueRow[]) => void
}

function EnvironmentVariablesEditor({
  rows,
  onChange,
}: EnvironmentVariablesEditorProps) {
  return (
    <div className="stack gap-sm">
      <div className="section-heading">
        <h2>Variáveis</h2>
        <button
          className="ghost-button ghost-button--compact"
          type="button"
          title="Adicionar variável"
          aria-label="Adicionar variável"
          onClick={() => onChange([...rows, createRow()])}
        >
          +
        </button>
      </div>

      <div className="environment-variables-list">
        {rows.map((row) => {
          const keyTrimmed = row.key.trim()
          const syntaxPreview = keyTrimmed ? `{{${keyTrimmed}}}` : '{{}}'
          const previewValue = row.value.trim() || 'Sem valor definido'

          return (
            <div className="environment-variable-card" key={row.id}>
              <div className="environment-variable-card__fields">
                <label className="field">
                  <span>Nome da variável</span>
                  <span className="field-preview">
                    Nome atual:{' '}
                    {keyTrimmed ? (
                      <code>{keyTrimmed}</code>
                    ) : (
                      <span className="subtle">—</span>
                    )}
                  </span>
                  <input
                    type="text"
                    placeholder="ex: baseUrl"
                    value={row.key}
                    onChange={(event) =>
                      onChange(
                        rows.map((current) =>
                          current.id === row.id
                            ? { ...current, key: event.target.value }
                            : current,
                        ),
                      )
                    }
                  />
                </label>

                <label className="field">
                  <span>Valor</span>
                  <span className="field-preview">Valor atual: {previewValue}</span>
                  <input
                    type="text"
                    placeholder="ex: https://api.exemplo.com"
                    value={row.value}
                    onChange={(event) =>
                      onChange(
                        rows.map((current) =>
                          current.id === row.id
                            ? { ...current, value: event.target.value }
                            : current,
                        ),
                      )
                    }
                  />
                </label>

                <p className="subtle helper-text environment-variable-card__usage">
                  Uso da variável: <code>{syntaxPreview}</code>
                </p>

                <div className="environment-variable-card__footer">
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={row.enabled}
                      onChange={(event) =>
                        onChange(
                          rows.map((current) =>
                            current.id === row.id
                              ? { ...current, enabled: event.target.checked }
                              : current,
                          ),
                        )
                      }
                    />
                    <span>
                      {row.enabled ? 'Variável ativa' : 'Variável inativa'}
                    </span>
                  </label>

                  <button
                    className="danger-button danger-button--compact"
                    type="button"
                    onClick={() => {
                      const nextRows = rows.filter((current) => current.id !== row.id)
                      onChange(nextRows.length === 0 ? [createRow()] : nextRows)
                    }}
                  >
                    Excluir
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function createHistoryEntry(
  tab: RequestTab,
  response: RequestResponse,
  environment: EnvironmentItem | undefined,
  resolvedUrl: string,
): HistoryEntry {
  return {
    id: crypto.randomUUID(),
    executedAt: response.receivedAt,
    method: tab.method,
    url: tab.url,
    resolvedUrl,
    status: response.status,
    durationMs: response.durationMs,
    environmentName: environment?.name,
    tabSnapshot: {
      ...cloneTab(tab),
      response,
    },
  }
}

function createSavedRequestFromTab(
  tab: RequestTab,
  collectionId: string,
  updatedAt: string,
): SavedRequestItem {
  const savedRequestId = tab.savedRequestId ?? crypto.randomUUID()

  return {
    id: savedRequestId,
    name: tab.name.trim() || 'Request sem nome',
    updatedAt,
    request: {
      ...sanitizeTabForSave(tab),
      collectionId,
      savedRequestId,
    },
  }
}

function sanitizeTabForSave(tab: RequestTab): RequestTab {
  return {
    ...cloneTab(tab),
    name: tab.name.trim() || 'Request sem nome',
    response: undefined,
    isSending: false,
    collectionId: tab.collectionId,
    savedRequestId: tab.savedRequestId,
  }
}

function createTabFromSavedRequest(
  savedRequest: SavedRequestItem,
  collectionId: string,
): RequestTab {
  return {
    ...hydrateTab(savedRequest.request),
    id: crypto.randomUUID(),
    name: savedRequest.name,
    response: undefined,
    isSending: false,
    collectionId,
    savedRequestId: savedRequest.id,
  }
}

function hydrateTab(raw: RequestTab): RequestTab {
  return {
    id: raw.id ?? crypto.randomUUID(),
    name: raw.name ?? 'Request',
    method: (raw.method ?? 'GET') as HttpMethod,
    url: raw.url ?? '',
    headers:
      raw.headers?.map((row) => ({
        ...row,
        id: row.id ?? crypto.randomUUID(),
        enabled: row.enabled ?? true,
      })) ?? [createRow()],
    queryParams:
      raw.queryParams?.map((row) => ({
        ...row,
        id: row.id ?? crypto.randomUUID(),
        enabled: row.enabled ?? true,
      })) ?? [createRow()],
    auth: hydrateAuth(raw.auth),
    body: hydrateBody(raw.body),
    response: raw.response,
    isSending: false,
    collectionId: raw.collectionId,
    savedRequestId: raw.savedRequestId,
  }
}

function hydrateHistoryEntry(raw: HistoryEntry): HistoryEntry {
  return {
    ...raw,
    tabSnapshot: hydrateTab(raw.tabSnapshot),
  }
}

function hydrateEnvironment(raw: EnvironmentItem): EnvironmentItem {
  return {
    id: raw.id ?? crypto.randomUUID(),
    name: raw.name ?? 'Environment',
    color: raw.color ?? 'branco',
    variables:
      raw.variables?.map((row) => ({
        ...row,
        id: row.id ?? crypto.randomUUID(),
        enabled: row.enabled ?? true,
      })) ?? [createRow()],
  }
}

function hydrateCollection(raw: CollectionItem): CollectionItem {
  return {
    id: raw.id ?? crypto.randomUUID(),
    name: raw.name ?? 'Collection',
    requests:
      raw.requests?.map((savedRequest) => ({
        id: savedRequest.id ?? crypto.randomUUID(),
        name: savedRequest.name ?? 'Request salva',
        updatedAt: savedRequest.updatedAt ?? new Date().toISOString(),
        request: hydrateTab(savedRequest.request),
      })) ?? [],
  }
}

function hydrateAuth(auth: AuthConfig | undefined): AuthConfig {
  if (!auth) {
    return { type: 'none' }
  }

  switch (auth.type) {
    case 'bearer':
      return { type: 'bearer', token: auth.token ?? '' }
    case 'basic':
      return {
        type: 'basic',
        username: auth.username ?? '',
        password: auth.password ?? '',
      }
    case 'apiKey':
      return {
        type: 'apiKey',
        key: auth.key ?? '',
        value: auth.value ?? '',
        addTo: auth.addTo ?? 'header',
      }
    default:
      return { type: 'none' }
  }
}

function hydrateBody(body: RequestBody | undefined): RequestBody {
  if (!body) {
    return { mode: 'none' }
  }

  if (body.mode === 'json' || body.mode === 'text') {
    return {
      mode: body.mode,
      content: body.content ?? '',
    }
  }

  if (body.mode === 'form') {
    return {
      mode: 'form',
      entries:
        body.entries?.map((row) => ({
          ...row,
          id: row.id ?? crypto.randomUUID(),
          enabled: row.enabled ?? true,
        })) ?? [createRow()],
    }
  }

  return { mode: 'none' }
}

function getStatusToneClass(status: number) {
  if (status >= 200 && status < 300) {
    return 'status-pill--success'
  }

  if (status >= 400) {
    return 'status-pill--error'
  }

  return 'status-pill--neutral'
}

function isJsonResponse(
  headers: Array<{ key: string; value: string }>,
  body: string,
) {
  const contentType =
    headers.find((header) => header.key.toLowerCase() === 'content-type')
      ?.value ?? ''

  if (contentType.toLowerCase().includes('json')) {
    return true
  }

  const trimmed = body.trim()
  if (
    trimmed.length > 0 &&
    (trimmed.startsWith('{') || trimmed.startsWith('['))
  ) {
    try {
      JSON.parse(trimmed)
      return true
    } catch {
      return false
    }
  }

  return false
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(value))
}

function formatSavedListDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatMetric(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: 2,
  }).format(value)
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min
  }

  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function getEnvironmentColorLabel(color: EnvironmentColor) {
  return (
    ENVIRONMENT_COLOR_OPTIONS.find((option) => option.value === color)?.label ??
    'Branco'
  )
}

export default App
