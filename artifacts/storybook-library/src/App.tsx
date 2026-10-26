import { useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Link, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import { useAuth } from '@workspace/replit-auth-web';
import {
  ArrowLeft, ArrowRight, BookOpen, Check, ChevronLeft, ChevronRight, Clock3, FileArchive,
  LogIn, LogOut, Search, ShieldCheck, Trash2, Upload, X,
} from 'lucide-react';
import {
  getGetAdminSummaryQueryKey, getGetBookQueryKey, getListAdminBooksQueryKey,
  getListBookCategoriesQueryKey, getListBooksQueryKey, useDeleteBook, useGetAdminSummary,
  useGetBook, useImportBook, useListAdminBooks, useListBookCategories, useListBooks,
  useRequestUploadUrl, useUpdateBook,
} from '@workspace/api-client-react';
import type { Book, BookImportInput } from '@workspace/api-client-react';

const queryClient = new QueryClient();
const colors = ['#dce9dc', '#f2ddc7', '#d9e5eb', '#efe4bc', '#e7dce8', '#d7e7df'];

function coverColor(book: Book) {
  const known: Record<string, string> = {
    sage: colors[0], peach: colors[1], sky: colors[2], golden: colors[3], lilac: colors[4], meadow: colors[5],
  };
  return known[book.coverStyle?.toLowerCase()] ?? colors[[...book.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % colors.length];
}

function Cover({ book, className = '' }: { book: Book; className?: string }) {
  return (
    <div className={`cover-art ${className}`} style={{ '--cover': coverColor(book) } as CSSProperties} data-testid={`cover-${book.id}`}>
      {book.coverUrl ? <img src={book.coverUrl} alt={`Cover of ${book.title}`} /> : <>
        <span className="cover-label">{book.title}</span>
        <span className="cover-author">{book.author}</span>
      </>}
    </div>
  );
}

function Brand() {
  return <Link href="/" className="brand" data-testid="link-home"><span className="brand-mark"><BookOpen size={19} /></span><span>Little Lantern</span></Link>;
}

function SiteHeader() {
  return <header className="topbar"><Brand /><nav className="nav-actions" aria-label="Main navigation">
    <Link href="/" className="nav-link" data-testid="link-library-nav">The library</Link>
  </nav></header>;
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="storybook-shell"><SiteHeader />{children}<footer className="footer"><span>A little light for wherever a story takes you.</span><Link href="/admin" className="footer-admin">For grown-ups</Link></footer></div>;
}

function Library() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const booksQuery = useListBooks({ search: search.trim() || undefined, category: category || undefined });
  const categoriesQuery = useListBookCategories();
  const books = booksQuery.data ?? [];

  return <Shell><main className="main-wrap">
    <section className="hero">
      <div className="hero-copy">
        <span className="eyebrow">Stories for every kind of curious</span>
        <h1>Come in.<br />Pick a story.</h1>
        <p>Small adventures, big feelings, and faraway places—ready whenever your family is.</p>
        <a className="hero-note" href="#book-shelf">Find your next read <ArrowRight size={16} /></a>
      </div>
    </section>
    <section id="book-shelf" aria-labelledby="shelf-title">
      <div className="shelf-heading">
        <div><span className="eyebrow">A shelf full of possibility</span><h2 id="shelf-title">Find a little wonder</h2><p>Browse by mood, or search for the story you have in mind.</p></div>
        <div className="search-row">
          <label className="search-box"><Search size={18} /><input type="search" placeholder="Search stories or authors" value={search} onChange={event => setSearch(event.target.value)} aria-label="Search books" data-testid="input-search-books" /></label>
        </div>
      </div>
      <div className="category-row" aria-label="Filter by category">
        <button className={`category-chip ${category === '' ? 'active' : ''}`} onClick={() => setCategory('')} data-testid="filter-category-all">Everything</button>
        {categoriesQuery.data?.map(item => <button key={item.name} className={`category-chip ${category === item.name ? 'active' : ''}`} onClick={() => setCategory(category === item.name ? '' : item.name)} data-testid={`filter-category-${item.name}`}>{item.name} <span>{item.count}</span></button>)}
      </div>
      {categoriesQuery.isError && <div className="notice" role="status">Categories could not be loaded. You can still search all stories.</div>}
      {booksQuery.isLoading ? <div className="book-grid" aria-label="Loading stories">{[1, 2, 3, 4].map(n => <div className="skeleton" key={n} />)}</div>
        : booksQuery.isError ? <div className="notice" role="alert">The story shelf could not be reached. <button className="nav-link" onClick={() => booksQuery.refetch()} data-testid="button-retry-books">Try again</button></div>
        : books.length === 0 ? <div className="notice" data-testid="empty-books">{search || category ? 'No stories match just yet. Try another search or browse everything.' : 'The shelf is quiet for now. Please visit again soon.'}</div>
        : <div className="book-grid">{books.map(book => <Link href={`/books/${book.id}`} className="book-card" key={book.id} data-testid={`card-book-${book.id}`}>
          <Cover book={book} />
          <div className="book-meta"><h3>{book.title}</h3><p>by {book.author}</p><div className="book-tags"><span className="tag-age">Ages {book.minAge}–{book.maxAge}</span><span>{book.readingMinutes} min</span></div></div>
        </Link>)}</div>}
    </section>
  </main></Shell>;
}

function BookDetail() {
  const { bookId = '' } = useParams<{ bookId: string }>();
  const query = useGetBook(bookId, { query: { queryKey: getGetBookQueryKey(bookId), enabled: !!bookId } });
  if (query.isLoading) return <Shell><main className="page"><div className="skeleton" /></main></Shell>;
  if (query.isError || !query.data) return <Shell><main className="page"><Link href="/" className="back-link"><ArrowLeft size={16} /> Back to the library</Link><div className="notice" role="alert">We couldn't open this story. It may have moved or is no longer available. <button className="nav-link" onClick={() => query.refetch()} data-testid="button-retry-book">Try again</button></div></main></Shell>;
  const book = query.data;
  return <Shell><main className="page">
    <Link href="/" className="back-link" data-testid="link-back-library"><ArrowLeft size={16} /> Back to the library</Link>
    <div className="detail-layout"><Cover book={book} /><section className="detail-copy">
      <span className="eyebrow">{book.categories.join(' · ')}</span>
      <h1>{book.title}</h1><p className="author">A story by {book.author}</p>
      <p className="description">{book.description}</p>
      <div className="detail-facts"><span>Ages {book.minAge}–{book.maxAge}</span><span><Clock3 size={15} /> {book.readingMinutes} minutes</span><span>{book.readerType === 'sample' ? 'Read a sample' : 'Interactive story'}</span></div>
      <div className="detail-actions"><Link href={`/read/${book.id}`} className="btn" data-testid={`button-read-${book.id}`}><BookOpen size={17} /> Open this story</Link><Link href="/" className="btn secondary" data-testid="link-more-stories">Choose another</Link></div>
    </section></div>
  </main></Shell>;
}

function Reader() {
  const { bookId = '' } = useParams<{ bookId: string }>();
  const query = useGetBook(bookId, { query: { queryKey: getGetBookQueryKey(bookId), enabled: !!bookId } });
  const [pageIndex, setPageIndex] = useState(0);
  if (query.isLoading) return <div className="reader-page"><div className="reader-content"><div className="skeleton" /></div></div>;
  if (query.isError || !query.data) return <div className="reader-page"><header className="reader-top"><Link href="/" className="back-link"><ArrowLeft size={16} /> Library</Link></header><div className="reader-content"><div className="notice" role="alert">This story could not be opened. <Link href="/" className="nav-link">Return to the library</Link></div></div></div>;
  const book = query.data;
  if (book.readerType === 'html5') return <div className="reader-page"><header className="reader-top"><Link href={`/books/${book.id}`} className="back-link" data-testid="link-close-reader"><X size={17} /> Close story</Link><span className="reader-title">{book.title}</span><span /></header><iframe className="reader-frame" title={`Interactive story: ${book.title}`} src={`/api/books/${book.id}/reader/index.html`} sandbox="allow-scripts" data-testid="iframe-html5-reader" /></div>;
  const pages = book.samplePages ?? [];
  const current = pages[pageIndex];
  return <div className="reader-page">
    <header className="reader-top"><Link href={`/books/${book.id}`} className="back-link" data-testid="link-close-reader"><X size={17} /> Close story</Link><span className="reader-title">{book.title}</span><span /></header>
    <main className="reader-content">{current ? <article className="story-page" data-testid={`story-page-${pageIndex + 1}`}>
      <span className="eyebrow">A story by {book.author}</span><h1>{current.title}</h1><p>{current.text}</p>
      {current.imageAlt && <span className="story-foot">{current.imageAlt}</span>}
    </article> : <div className="story-page"><BookOpen size={34} color="#789982" /><h1>A little pause</h1><p>This book has no sample pages to show yet. Come back to the story details to choose another.</p><Link className="btn" href={`/books/${book.id}`}>Story details</Link></div>}</main>
    {pages.length > 0 && <footer className="reader-controls"><button className="circle-btn" onClick={() => setPageIndex(i => Math.max(0, i - 1))} disabled={pageIndex === 0} aria-label="Previous page" data-testid="button-previous-page"><ChevronLeft size={19} /></button><span>Page {pageIndex + 1} of {pages.length}</span><button className="circle-btn" onClick={() => setPageIndex(i => Math.min(pages.length - 1, i + 1))} disabled={pageIndex >= pages.length - 1} aria-label="Next page" data-testid="button-next-page"><ChevronRight size={19} /></button></footer>}
  </div>;
}

type UploadFields = Omit<BookImportInput, 'archiveObjectPath'>;
const initialFields: UploadFields = { title: '', author: '', description: '', categories: [], minAge: 4, maxAge: 8, readingMinutes: 10 };

function Admin() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const summaryQuery = useGetAdminSummary({ query: { queryKey: getGetAdminSummaryQueryKey(), enabled: auth.isAuthenticated } });
  const booksQuery = useListAdminBooks({ query: { queryKey: getListAdminBooksQueryKey(), enabled: auth.isAuthenticated } });
  const importBook = useImportBook();
  const updateBook = useUpdateBook();
  const deleteBook = useDeleteBook();
  const requestUpload = useRequestUploadUrl();
  const [fields, setFields] = useState<UploadFields>(initialFields);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const isWorking = requestUpload.isPending || importBook.isPending;

  async function onUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploadError('');
    setUploadSuccess(false);
    if (!file) { setUploadError('Choose a ZIP archive before importing.'); return; }
    if (!file.name.toLowerCase().endsWith('.zip')) { setUploadError('The selected file must be a .zip archive.'); return; }
    if (!fields.title.trim() || !fields.author.trim() || !fields.description.trim() || fields.categories.length === 0) { setUploadError('Add a title, author, description, and at least one category.'); return; }
    if (fields.minAge > fields.maxAge) { setUploadError('The youngest age must be no greater than the oldest age.'); return; }
    try {
      setProgress('Preparing a secure upload…');
      const upload = await requestUpload.mutateAsync({ data: { name: file.name, size: file.size, contentType: file.type || 'application/zip' } });
      setProgress('Uploading archive…');
      const put = await fetch(upload.uploadURL, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/zip' }, body: file });
      if (!put.ok) throw new Error(`Upload failed (${put.status}). Please try the ZIP again.`);
      setProgress('Adding story to your shelf…');
      await importBook.mutateAsync({ data: { ...fields, title: fields.title.trim(), author: fields.author.trim(), description: fields.description.trim(), archiveObjectPath: upload.objectPath } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListAdminBooksQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetAdminSummaryQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListBooksQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListBookCategoriesQueryKey() }),
      ]);
      setFields(initialFields); setFile(null); setUploadSuccess(true); setProgress('');
      const input = document.getElementById('zip-input') as HTMLInputElement | null;
      if (input) input.value = '';
    } catch (error) {
      setProgress('');
      setUploadError(error instanceof Error ? error.message : 'We could not import that book. Check the archive and try again.');
    }
  }

  async function changePublished(book: Book) {
    try {
      await updateBook.mutateAsync({ bookId: book.id, data: { published: !book.published } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListAdminBooksQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetAdminSummaryQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListBooksQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetBookQueryKey(book.id) }),
        queryClient.invalidateQueries({ queryKey: getListBookCategoriesQueryKey() }),
      ]);
    } catch { setUploadError(`Could not update “${book.title}”. Please try again.`); }
  }

  async function removeBook(book: Book) {
    if (!window.confirm(`Delete “${book.title}” from the library? This cannot be undone.`)) return;
    try {
      await deleteBook.mutateAsync({ bookId: book.id });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListAdminBooksQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetAdminSummaryQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListBooksQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetBookQueryKey(book.id) }),
        queryClient.invalidateQueries({ queryKey: getListBookCategoriesQueryKey() }),
      ]);
    } catch { setUploadError(`Could not delete “${book.title}”. Please try again.`); }
  }

  if (auth.isLoading) return <Shell><main className="admin-wrap"><div className="skeleton" /></main></Shell>;
  if (!auth.isAuthenticated) return <Shell><main className="admin-wrap"><Link href="/" className="back-link"><ArrowLeft size={16} /> Public library</Link><section className="notice" style={{ maxWidth: 560, margin: '60px auto', padding: 30, textAlign: 'center' }}><ShieldCheck size={34} /><h1 style={{ fontFamily: 'var(--font-serif)', color: '#315d4c' }}>This shelf is private</h1><p>Sign in to manage storybooks and keep the library just so.</p><button className="btn" onClick={auth.login} data-testid="button-admin-login"><LogIn size={16} /> Log in to continue</button></section></main></Shell>;

  const adminError = (summaryQuery.error ?? booksQuery.error) as { response?: { status?: number }; status?: number } | null;
  const unauthorized = adminError?.response?.status === 401 || adminError?.response?.status === 403 || adminError?.status === 401 || adminError?.status === 403;
  if (unauthorized) return <Shell><main className="admin-wrap"><div className="notice" role="alert"><ShieldCheck size={20} /> Your session does not have permission to manage this library. <button className="nav-link" onClick={auth.logout}>Sign out</button></div></main></Shell>;

  return <Shell><main className="admin-wrap">
    <Link href="/" className="back-link"><ArrowLeft size={16} /> Public library</Link>
    <header className="admin-header"><div><span className="eyebrow">A tidy little back room</span><h1>Story shelf</h1><p>Import a book, or decide what readers can see.</p></div><button className="btn secondary" onClick={auth.logout} data-testid="button-admin-logout"><LogOut size={15} /> Log out</button></header>
    {summaryQuery.isLoading ? <div className="stats">{[1, 2, 3].map(i => <div className="skeleton" key={i} />)}</div>
      : summaryQuery.isError ? <div className="notice" role="alert">Your shelf summary could not load. <button className="nav-link" onClick={() => summaryQuery.refetch()}>Retry</button></div>
      : <div className="stats"><div className="stat"><strong>{summaryQuery.data?.totalBooks ?? 0}</strong><span>BOOKS ON THE SHELF</span></div><div className="stat"><strong>{summaryQuery.data?.publishedBooks ?? 0}</strong><span>AVAILABLE TO READ</span></div><div className="stat"><strong>{summaryQuery.data?.categories ?? 0}</strong><span>STORY CATEGORIES</span></div></div>}
    <form className="upload-card" onSubmit={onUpload}>
      <h2>Bring in a new story</h2><p>Choose a ZIP package and tell us a little about the book.</p>
      <div className="form-grid">
        <label className="field">Book title<input required maxLength={120} value={fields.title} onChange={e => setFields({ ...fields, title: e.target.value })} data-testid="input-book-title" /></label>
        <label className="field">Author<input required maxLength={120} value={fields.author} onChange={e => setFields({ ...fields, author: e.target.value })} data-testid="input-book-author" /></label>
        <label className="field full">Short description<textarea required maxLength={1000} value={fields.description} onChange={e => setFields({ ...fields, description: e.target.value })} data-testid="input-book-description" /></label>
        <label className="field full">Categories <span>Separate categories with commas</span><input required value={fields.categories.join(', ')} onChange={e => setFields({ ...fields, categories: e.target.value.split(',').map(value => value.trim()).filter(Boolean) })} data-testid="input-book-categories" /></label>
        <label className="field">Youngest reader<input type="number" min="0" max="18" required value={fields.minAge} onChange={e => setFields({ ...fields, minAge: Number(e.target.value) })} data-testid="input-min-age" /></label>
        <label className="field">Oldest reader<input type="number" min="0" max="18" required value={fields.maxAge} onChange={e => setFields({ ...fields, maxAge: Number(e.target.value) })} data-testid="input-max-age" /></label>
        <label className="field">Reading minutes<input type="number" min="1" max="240" required value={fields.readingMinutes} onChange={e => setFields({ ...fields, readingMinutes: Number(e.target.value) })} data-testid="input-reading-minutes" /></label>
        <label className="field">Book archive (.zip)<input id="zip-input" type="file" accept=".zip,application/zip" required onChange={e => setFile(e.target.files?.[0] ?? null)} data-testid="input-book-zip" /></label>
      </div>
      <div className="upload-footer"><div>{progress && <span role="status">{progress}</span>}{uploadError && <span role="alert" style={{ color: '#9d483e' }}>{uploadError}</span>}{uploadSuccess && <span role="status" style={{ color: '#38694f' }}><Check size={16} /> Story imported and added to the shelf.</span>}</div><button type="submit" className="btn" disabled={isWorking} data-testid="button-import-book">{isWorking ? <><Upload size={16} /> Working…</> : <><FileArchive size={16} /> Upload & import</>}</button></div>
    </form>
    {booksQuery.isLoading ? <div className="admin-table">{[1, 2, 3].map(i => <div className="skeleton" key={i} />)}</div>
      : booksQuery.isError ? <div className="notice" role="alert">The book list could not load. <button className="nav-link" onClick={() => booksQuery.refetch()}>Retry</button></div>
      : (booksQuery.data ?? []).length === 0 ? <div className="notice" data-testid="empty-admin-books">No books yet. Import a ZIP above to start this shelf.</div>
      : <div className="admin-table" role="table" aria-label="Book administration"><div className="admin-row header" role="row"><span>Book</span><span>Categories</span><span>Status</span><span style={{ textAlign: 'right' }}>Actions</span></div>{(booksQuery.data ?? []).map(book => <div className="admin-row" role="row" key={book.id} data-testid={`admin-book-${book.id}`}>
        <span className="admin-book"><span className="mini-cover">{book.title.slice(0, 1)}</span><span>{book.title}<small style={{ display: 'block', color: '#839084', fontWeight: 400 }}>{book.author}</small></span></span>
        <span>{book.categories.join(', ') || '—'}</span><span><span className={`status-pill ${book.published ? 'live' : 'draft'}`}>{book.published ? 'Published' : 'Draft'}</span></span>
        <span className="row-actions"><button className="icon-action" title={book.published ? 'Unpublish book' : 'Publish book'} aria-label={book.published ? `Unpublish ${book.title}` : `Publish ${book.title}`} onClick={() => changePublished(book)} disabled={updateBook.isPending} data-testid={`button-toggle-publish-${book.id}`}>{book.published ? <X size={16} /> : <Check size={16} />}</button><button className="icon-action delete" title="Delete book" aria-label={`Delete ${book.title}`} onClick={() => removeBook(book)} disabled={deleteBook.isPending} data-testid={`button-delete-book-${book.id}`}><Trash2 size={16} /></button></span>
      </div>)}</div>}
  </main></Shell>;
}

function Router() {
  return <RoutedErrorBoundary><Switch>
    <Route path="/" component={Library} />
    <Route path="/books/:bookId" component={BookDetail} />
    <Route path="/read/:bookId" component={Reader} />
    <Route path="/admin" component={Admin} />
    <Route component={NotFound} />
  </Switch></RoutedErrorBoundary>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
