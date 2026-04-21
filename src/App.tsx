import { useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';

type Word = {
  id: string;
  en: string;
  ko: string;
  created_at: string;
};

type ViewMode = 'study' | 'memorized' | 'unmemorized';

const SAMPLE_TEXT = `distinguished\t저명한, 현란한
accomplished\t뛰어난
be delighted to + V\t~해서 기쁘다`;

const ALLOWED_IDS = new Set(['admin', 'ssh', 'njh']);
const REMEMBER_LOGIN_STORAGE_KEY = 'vocaca_remember_login';

const parseVocabulary = (input: string) => {
  const seen = new Set<string>();

  return input
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\t| {2,}/).map((part) => part.trim());
      const [en = '', ...rest] = parts;
      const ko = rest.join(' ').trim();

      return { en, ko };
    })
    .filter((word) => word.en && word.ko)
    .filter((word) => {
      const key = `${word.en}__${word.ko}`;

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
};

const formatProgress = (memorizedCount: number, totalCount: number) => {
  if (totalCount === 0) {
    return 'Progress: 0 / 0 (0%)';
  }

  const percentage = Math.round((memorizedCount / totalCount) * 100);
  return `Progress: ${memorizedCount} / ${totalCount} (${percentage}%)`;
};

const mapLoginIdToEmail = (loginId: string) => {
  const normalizedId = loginId.trim().toLowerCase();

  if (!ALLOWED_IDS.has(normalizedId)) {
    return null;
  }

  return `${normalizedId}@vocaca.local`;
};

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isDataLoading, setIsDataLoading] = useState(false);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isTogglingMemorized, setIsTogglingMemorized] = useState(false);

  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [rememberLogin, setRememberLogin] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    return window.localStorage.getItem(REMEMBER_LOGIN_STORAGE_KEY) === 'true';
  });
  const [authError, setAuthError] = useState('');

  const [words, setWords] = useState<Word[]>([]);
  const [memorizedWordIds, setMemorizedWordIds] = useState<Set<string>>(new Set());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');
  const [dataError, setDataError] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('study');

  const activeFetchIdRef = useRef(0);

  const memorizedWords = useMemo(
    () => words.filter((word) => memorizedWordIds.has(word.id)),
    [memorizedWordIds, words],
  );
  const unmemorizedWords = useMemo(
    () => words.filter((word) => !memorizedWordIds.has(word.id)),
    [memorizedWordIds, words],
  );
  const activeWords = useMemo(() => {
    if (viewMode === 'memorized') {
      return memorizedWords;
    }

    if (viewMode === 'unmemorized') {
      return unmemorizedWords;
    }

    return words;
  }, [memorizedWords, unmemorizedWords, viewMode, words]);
  const currentWord = activeWords[currentIndex] ?? null;
  const memorizedCount = memorizedWordIds.size;
  const currentWordIsMemorized = currentWord ? memorizedWordIds.has(currentWord.id) : false;
  const isAdminUser = session?.user.email === 'admin@vocaca.local';

  const progressLabel = useMemo(
    () => formatProgress(memorizedCount, words.length),
    [memorizedCount, words.length],
  );

  useEffect(() => {
    setCurrentIndex((prev) => {
      if (activeWords.length === 0) {
        return 0;
      }

      return Math.min(prev, activeWords.length - 1);
    });
    setIsFlipped(false);
  }, [activeWords]);

  useEffect(() => {
    let isMounted = true;

    const bootstrap = async () => {
      const {
        data: { session: initialSession },
        error,
      } = await supabase.auth.getSession();

      if (!isMounted) {
        return;
      }

      if (error) {
        setAuthError(error.message);
      }

      setSession(initialSession);

      if (initialSession?.user.id) {
        await fetchAppData(initialSession.user.id);
      }

      if (isMounted) {
        setIsInitializing(false);
      }
    };

    void bootstrap();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      activeFetchIdRef.current += 1;
      setSession(nextSession);
      setAuthError('');

      if (!nextSession) {
        setWords([]);
        setMemorizedWordIds(new Set());
        setCurrentIndex(0);
        setIsFlipped(false);
        setViewMode('study');
        setImportText('');
        setImportError('');
        setDataError('');
        setIsDataLoading(false);
        setIsInitializing(false);
        return;
      }

      setIsInitializing(false);
      void fetchAppData(nextSession.user.id);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const fetchAppData = async (userId: string) => {
    const requestId = ++activeFetchIdRef.current;

    setIsDataLoading(true);
    setDataError('');

    const { data: wordsData, error: wordsError } = await supabase
      .from('words')
      .select('id, en, ko, created_at')
      .order('created_at', { ascending: true });

    if (requestId !== activeFetchIdRef.current) {
      return;
    }

    if (wordsError) {
      setDataError(wordsError.message);
      setWords([]);
      setMemorizedWordIds(new Set());
      setCurrentIndex(0);
      setIsFlipped(false);
      setViewMode('study');
      setIsDataLoading(false);
      return;
    }

    const nextWords = wordsData ?? [];
    setWords(nextWords);
    setCurrentIndex((prev) => {
      if (nextWords.length === 0) {
        return 0;
      }

      return Math.min(prev, nextWords.length - 1);
    });
    setIsFlipped(false);

    if (nextWords.length === 0) {
      setMemorizedWordIds(new Set());
      setIsDataLoading(false);
      return;
    }

    const { data: progressData, error: progressError } = await supabase
      .from('user_progress')
      .select('word_id')
      .eq('user_id', userId)
      .eq('is_memorized', true);

    if (requestId !== activeFetchIdRef.current) {
      return;
    }

    if (progressError) {
      setDataError(progressError.message);
      setMemorizedWordIds(new Set());
      setIsDataLoading(false);
      return;
    }

    setMemorizedWordIds(new Set((progressData ?? []).map((item) => item.word_id)));
    setIsDataLoading(false);
  };

  const handleLogin = async () => {
    setIsAuthSubmitting(true);
    setAuthError('');

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(REMEMBER_LOGIN_STORAGE_KEY, String(rememberLogin));
    }

    const email = mapLoginIdToEmail(loginId);

    if (!email || !password) {
      setAuthError('허용된 ID는 admin, ssh, njh 입니다.');
      setIsAuthSubmitting(false);
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setAuthError(error.message);
    }

    setIsAuthSubmitting(false);
  };

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();

    if (error) {
      setDataError(error.message);
    }
  };

  const handleImportWords = async () => {
    if (!isAdminUser) {
      setImportError('공유 단어장 등록은 admin 계정만 가능합니다.');
      return;
    }

    const parsedWords = parseVocabulary(importText);

    if (parsedWords.length === 0) {
      setImportError('최소 1개 이상의 올바른 단어 줄을 입력하세요.');
      return;
    }

    setIsImporting(true);
    setImportError('');
    setDataError('');

    const { data: existingWords, error: existingWordsError } = await supabase
      .from('words')
      .select('id')
      .limit(1);

    if (existingWordsError) {
      setImportError(existingWordsError.message);
      setIsImporting(false);
      return;
    }

    if ((existingWords ?? []).length > 0) {
      setImportError('이미 공유 단어장이 생성되어 있습니다.');
      setIsImporting(false);
      if (session?.user.id) {
        await fetchAppData(session.user.id);
      }
      return;
    }

    const { error } = await supabase.from('words').insert(parsedWords);

    if (error) {
      setImportError(error.message);
      setIsImporting(false);
      return;
    }

    setImportText('');
    setIsImporting(false);

    if (session?.user.id) {
      await fetchAppData(session.user.id);
    }
  };

  const resetFlip = () => {
    setIsFlipped(false);
  };

  const handlePrevious = () => {
    if (activeWords.length === 0) {
      return;
    }

    setCurrentIndex((prev) => (prev === 0 ? activeWords.length - 1 : prev - 1));
    resetFlip();
  };

  const handleNext = () => {
    if (activeWords.length === 0) {
      return;
    }

    setCurrentIndex((prev) => (prev === activeWords.length - 1 ? 0 : prev + 1));
    resetFlip();
  };

  const handleToggleMemorizedForWord = async (word: Word) => {
    if (!session?.user.id) {
      return;
    }

    const nextIsMemorized = !memorizedWordIds.has(word.id);
    const previousIds = memorizedWordIds;
    const nextIds = new Set(previousIds);

    if (nextIsMemorized) {
      nextIds.add(word.id);
    } else {
      nextIds.delete(word.id);
    }

    setMemorizedWordIds(nextIds);
    setIsTogglingMemorized(true);
    setDataError('');

    const { error } = await supabase.from('user_progress').upsert(
      {
        user_id: session.user.id,
        word_id: word.id,
        is_memorized: nextIsMemorized,
      },
      {
        onConflict: 'user_id,word_id',
      },
    );

    if (error) {
      setMemorizedWordIds(previousIds);
      setDataError(error.message);
    }

    setIsTogglingMemorized(false);
  };

  const handleToggleMemorized = async () => {
    if (!currentWord) {
      return;
    }

    await handleToggleMemorizedForWord(currentWord);
  };

  if (isInitializing) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
          <h1 className="text-2xl font-bold text-slate-950">Vocaca</h1>
          <p className="mt-3 text-sm text-slate-500">Loading your workspace...</p>
        </div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-6">
        <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-6 text-center">
            <h1 className="text-3xl font-bold tracking-tight text-slate-950">Vocaca</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              허용된 계정만 로그인할 수 있습니다.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor="login-id" className="mb-2 block text-sm font-medium text-slate-700">
                ID
              </label>
              <input
                id="login-id"
                type="text"
                value={loginId}
                onChange={(event) => setLoginId(event.target.value)}
                placeholder="아이디 입력"
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-900"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-2 block text-sm font-medium text-slate-700"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="비밀번호 입력"
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-900"
              />
            </div>

            <label className="flex items-center gap-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={rememberLogin}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setRememberLogin(checked);

                  if (typeof window !== 'undefined') {
                    window.localStorage.setItem(
                      REMEMBER_LOGIN_STORAGE_KEY,
                      String(checked),
                    );
                  }
                }}
                className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
              />
              로그인 정보 저장
            </label>
          </div>

          {authError ? (
            <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
              {authError}
            </p>
          ) : null}

          <button
            type="button"
            onClick={() => void handleLogin()}
            disabled={isAuthSubmitting}
            className="mt-5 w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isAuthSubmitting ? '로그인 중...' : 'Login'}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900">
      <div className="mx-auto w-full max-w-md">
        <header className="mb-4 rounded-3xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-950">Vocaca</h1>
              <p className="mt-1 text-sm text-slate-500">{session.user.email}</p>
            </div>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Sign Out
            </button>
          </div>
        </header>

        {dataError ? (
          <p className="mb-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
            {dataError}
          </p>
        ) : null}

        {isDataLoading ? (
          <section className="rounded-3xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
            <p className="text-sm text-slate-500">Loading words and progress...</p>
          </section>
        ) : words.length === 0 ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-slate-950">Initialize Shared Vocabulary</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                {isAdminUser
                  ? '`words` 테이블이 비어 있을 때 admin 계정으로 한 번만 단어장을 등록하면 됩니다.'
                  : '공유 단어장은 admin 계정만 등록할 수 있습니다. admin으로 로그인해서 먼저 단어장을 만들어주세요.'}
              </p>
            </div>

            {isAdminUser ? (
              <textarea
                value={importText}
                onChange={(event) => setImportText(event.target.value)}
                placeholder={SAMPLE_TEXT}
                spellCheck={false}
                className="min-h-72 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-900"
              />
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                admin 계정에서 단어장을 등록하면 이 화면 대신 학습 카드가 표시됩니다.
              </div>
            )}

            {importError ? (
              <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
                {importError}
              </p>
            ) : null}

            {isAdminUser ? (
              <button
                type="button"
                onClick={() => void handleImportWords()}
                disabled={isImporting}
                className="mt-4 w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isImporting ? 'Importing...' : 'Import Shared Words'}
              </button>
            ) : null}
          </section>
        ) : (
          <section className="space-y-4">
            <div className="grid grid-cols-3 gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
              {(
                [
                  ['study', '학습'],
                  ['memorized', `외운 단어 ${memorizedWords.length}`],
                  ['unmemorized', `못 외운 단어 ${unmemorizedWords.length}`],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                    viewMode === mode
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-slate-700">{progressLabel}</p>
                <p className="text-xs text-slate-400">
                  {activeWords.length === 0 ? '0 / 0' : `${currentIndex + 1} / ${activeWords.length}`}
                </p>
              </div>
            </div>

            {activeWords.length === 0 ? (
              <section className="rounded-3xl border border-slate-200 bg-white px-5 py-10 text-center shadow-sm">
                <p className="text-sm text-slate-500">
                  {viewMode === 'memorized'
                    ? '외운 단어가 아직 없습니다.'
                    : viewMode === 'unmemorized'
                      ? '모든 단어를 외웠습니다.'
                      : '표시할 단어가 없습니다.'}
                </p>
              </section>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setIsFlipped((prev) => !prev)}
                  className="block w-full text-left focus:outline-none"
                  aria-label="Flip flashcard"
                >
                  <div className="relative mx-auto h-64 w-full max-w-md" style={{ perspective: '1200px' }}>
                    <div
                      className="relative h-full w-full rounded-3xl transition-transform duration-500"
                      style={{
                        transformStyle: 'preserve-3d',
                        transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
                      }}
                    >
                      <div
                        className="absolute inset-0 flex h-full w-full flex-col justify-between rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
                        style={{ backfaceVisibility: 'hidden' }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
                            English
                          </span>
                          <span className="text-xs text-slate-400">Tap to flip</span>
                        </div>
                        <div className="flex flex-1 items-center justify-center text-center">
                          <p className="text-3xl font-bold leading-tight tracking-tight text-slate-950">
                            {currentWord?.en}
                          </p>
                        </div>
                        <p className="text-center text-sm text-slate-500">
                          {currentWordIsMemorized ? 'Memorized' : 'Not memorized yet'}
                        </p>
                      </div>

                      <div
                        className="absolute inset-0 flex h-full w-full flex-col justify-between rounded-3xl border border-slate-200 bg-slate-950 p-6 text-white shadow-sm"
                        style={{
                          backfaceVisibility: 'hidden',
                          transform: 'rotateY(180deg)',
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-slate-200">
                            Korean
                          </span>
                          <span className="text-xs text-slate-300">Tap to flip</span>
                        </div>
                        <div className="flex flex-1 items-center justify-center text-center">
                          <p className="text-3xl font-bold leading-tight tracking-tight text-white">
                            {currentWord?.ko}
                          </p>
                        </div>
                        <p className="text-center text-sm text-slate-300">Shared vocabulary card</p>
                      </div>
                    </div>
                  </div>
                </button>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={handlePrevious}
                    className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={handleNext}
                    className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Next
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => void handleToggleMemorized()}
                  disabled={isTogglingMemorized || !currentWord}
                  className={`w-full rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                    currentWordIsMemorized
                      ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                      : 'bg-slate-950 text-white hover:bg-slate-800'
                  } disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  {isTogglingMemorized
                    ? 'Saving...'
                    : currentWordIsMemorized
                      ? 'Unmark Memorized'
                      : 'Mark as Memorized'}
                </button>
              </>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
