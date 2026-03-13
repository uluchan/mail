import { useState, useEffect } from 'react'
import { MessageSquare, Settings, ChevronDown, Activity, Cpu, Zap, AlertCircle, RefreshCw, Sparkles, Plus, Database, ChevronLeft, ChevronRight, CheckCircle, Mail as MailIcon, Layout, Search, Menu, X, Send, LogOut } from 'lucide-react'
import { GoogleGenerativeAI } from "@google/generative-ai"
import './App.css'
import SettingsModal from './components/SettingsModal'
import MailModal from './components/MailModal'
import SectorManagementModal from './components/SectorManagementModal'
import CustomerModal from './components/CustomerModal'
import { API_BASE } from './apiConfig'
import './components/MailModal.css'
import { Pencil, Trash2 } from 'lucide-react'

function App() {
  console.log("App rendering...");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isSectorModalOpen, setIsSectorModalOpen] = useState(false)
  const [isSectorDropdownOpen, setIsSectorDropdownOpen] = useState(false)
  const [selectedMailCustomer, setSelectedMailCustomer] = useState(null)
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false)
  const [selectedCustomerForEdit, setSelectedCustomerForEdit] = useState(null)
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '')
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [googleStatus, setGoogleStatus] = useState({ authenticated: false, email: '' })
  const [selectedCustomers, setSelectedCustomers] = useState(new Set())
  const [bulkSending, setBulkSending] = useState({ active: false, current: 0, total: 0, status: '' })

  // Sectors state for global use
  const [allSectors, setAllSectors] = useState([])
  const [allCities, setAllCities] = useState([])

  // App State
  const [services, setServices] = useState([])
  const [selectedService, setSelectedService] = useState(null)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [dbStatus, setDbStatus] = useState({ loading: true, connected: false, message: '' })
  const [customerFilters, setCustomerFilters] = useState({ 
    city: '', 
    district: '',
    mainSectorId: '', 
    subSectorId: '', 
    search: '',
    company_name: '',
    email: '',
    website: '',
    status: '',
    notes: ''
  })

  // Search Parameters & Results
  const [searchParams, setSearchParams] = useState({ city: '', district: '', sector: '', mainSector: '' })
  const [aiResults, setAiResults] = useState([])
  const [isAiLoading, setIsAiLoading] = useState(false)
  const [searchProgress, setSearchProgress] = useState(0)
  const [searchStatus, setSearchStatus] = useState('')
  const [selectedForDb, setSelectedForDb] = useState(new Set())
  const [isAutoDiscovering, setIsAutoDiscovering] = useState(false)
  const [autoDiscoverStatus, setAutoDiscoverStatus] = useState({ total: 0, current: 0, currentSector: '', startTime: null, estimatedTotalTime: 0 })
  
  const [isSurpriseActive, setIsSurpriseActive] = useState(false)
  const [surpriseStats, setSurpriseStats] = useState({ totalFound: 0, startTime: null, avgTimePerCustomer: 0, currentStatus: '' })

  const majorCities = [
    'İstanbul', 'Ankara', 'İzmir', 'Bursa', 'Antalya', 'Adana', 'Konya', 'Gaziantep', 'Mersin', 'Kayseri',
    'Eskişehir', 'Denizli', 'Samsun', 'Sakarya', 'Muğla', 'Aydın', 'Balıkesir', 'Tekirdağ'
  ];

  // Customer List State (Pagination)
  const [customers, setCustomers] = useState([])
  const [isCustomersLoading, setIsCustomersLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [pagination, setPagination] = useState({ totalPages: 0, total: 0 })

  // Usage Stats (Persistent)
  const [usage, setUsage] = useState(() => {
    try {
      const saved = localStorage.getItem('gemini_usage_stats');
      const now = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
      const defaultStats = { rpm: 0, rpd: 0, tpm: 0, lastUpdate: now };

      if (!saved) return defaultStats;

      const parsed = JSON.parse(saved);
      // Daily Reset Check
      if (parsed.lastUpdate !== now) {
        return { ...defaultStats, rpm: 0 };
      }
      return parsed;
    } catch (e) {
      console.error("Usage stats parse error:", e);
      return { rpm: 0, rpd: 0, tpm: 0, lastUpdate: new Date().toLocaleDateString('en-CA') };
    }
  });

  useEffect(() => {
    localStorage.setItem('gemini_usage_stats', JSON.stringify(usage));
  }, [usage]);

  // Reset RPM every minute and Check Date change
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date().toLocaleDateString('en-CA');
      setUsage(prev => {
        const isNewDay = prev.lastUpdate !== now;
        return {
          ...prev,
          rpm: 0,
          rpd: isNewDay ? 0 : prev.rpd,
          tpm: isNewDay ? 0 : prev.tpm,
          lastUpdate: now
        };
      });
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    checkDbStatus()
    fetchCustomers(1)
    fetchSectors()
    fetchCities()
    checkGoogleStatus()
  }, [])

  const checkGoogleStatus = async () => {
    try {
      const resp = await fetch(`${API_BASE}/auth/google/status`)
      const data = await resp.json()
      setGoogleStatus(data)
    } catch (err) {
      console.error("Google status check failed:", err)
    }
  }

  const handleGoogleLogin = async () => {
    try {
      const currentOrigin = window.location.origin;
      const redirectUri = currentOrigin.includes('localhost') 
        ? 'http://localhost:3001/api/auth/google/callback'
        : `${currentOrigin}/api/auth/google/callback`;

      // 1. Open popup immediately to prevent popup blocker
      const width = 600, height = 700;
      const left = (window.innerWidth / 2) - (width / 2);
      const top = (window.innerHeight / 2) - (height / 2);
      const authWindow = window.open('about:blank', 'Google Login', `width=${width},height=${height},left=${left},top=${top}`);
      
      if (authWindow) {
        authWindow.document.write('<div style="font-family:sans-serif;text-align:center;margin-top:50px;"><h2>Google\'a Bağlanılıyor...</h2><p>Lütfen bekleyin...</p></div>');
      } else {
        alert("Lütfen tarayıcınızın pop-up engelleyicisini kapatın.");
        return;
      }

      // 2. Fetch the actual URL
      const resp = await fetch(`${API_BASE}/auth/google/url?redirectUri=${encodeURIComponent(redirectUri)}`)
      const { url } = await resp.json()
      
      // 3. Update popup URL
      authWindow.location.href = url;

      const checkInterval = setInterval(() => {
        if (authWindow.closed) {
          clearInterval(checkInterval);
          checkGoogleStatus();
        }
      }, 1000);
    } catch (err) {
      alert("Google login failed: " + err.message)
    }
  }

  const handleGoogleLogout = async () => {
    if (!confirm("Google oturumunu kapatmak istediğinize emin misiniz?")) return;
    try {
      const resp = await fetch(`${API_BASE}/auth/google/logout`, { method: 'POST' });
      if (resp.ok) {
        setGoogleStatus({ authenticated: false, email: '' });
      }
    } catch (err) {
      console.error("Logout failed:", err);
    }
  }

  useEffect(() => {
    if (apiKey) fetchRealServices(apiKey)
  }, [apiKey])

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchCustomers(1, customerFilters)
    }, 300)
    return () => clearTimeout(timer)
  }, [customerFilters])

  // Handle click outside for dropdowns
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (e.target && e.target.closest) {
        if (!e.target.closest('.searchable-dropdown')) {
          setIsSectorDropdownOpen(false)
        }
        if (!e.target.closest('.model-dropdown-container')) {
          setIsDropdownOpen(false)
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const fetchSectors = async () => {
    try {
      const resp = await fetch(`${API_BASE}/sectors`)
      const data = await resp.json()
      if (Array.isArray(data)) {
        setAllSectors(data)
      } else {
        setAllSectors([])
      }
    } catch (err) {
      setAllSectors([])
    }
  }

  const fetchCities = async () => {
    try {
      const resp = await fetch(`${API_BASE}/cities`)
      const data = await resp.json()
      if (Array.isArray(data)) {
        setAllCities(data)
      }
    } catch (err) { }
  }

  const checkDbStatus = async () => {
    try {
      const response = await fetch(`${API_BASE}/db-status`)
      const data = await response.json()
      setDbStatus({
        loading: false,
        connected: data && data.status === 'connected',
        message: data ? data.message : 'Invalid response from server'
      })
    } catch (err) {
      setDbStatus({ loading: false, connected: false, message: 'Could not reach backend' })
    }
  }

  const fetchRealServices = async (key) => {
    if (services.length > 0 && !key) return;
    setLoading(true);
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error.message);

      const models = (data.models || [])
        .filter(m =>
          m && m.name &&
          m.supportedGenerationMethods?.includes('generateContent') &&
          !m.name.includes('embedding') &&
          !m.name.includes('aqa')
        )
        .map(m => {
          const id = m.name.split('/').pop();

          let version = 1;
          if (id.includes('3.1')) version = 3.1;
          else if (id.includes('3.0') || id.startsWith('gemini-3')) version = 3;
          else if (id.includes('2.5')) version = 2.5;
          else if (id.includes('2.0') || id.startsWith('gemini-2')) version = 2;
          else if (id.includes('1.5')) version = 1.5;

          // Free Tier Heuristics
          let limits = { rpm: 15, rpd: 1500, tpm: 1000000 };

          if (id.includes('pro')) {
            limits = { rpm: 2, rpd: 50, tpm: 32000 };
          } else if (id.includes('lite')) {
            limits = { rpm: 30, rpd: 2000, tpm: 1000000 };
          } else if (version >= 3) {
            limits = { rpm: 20, rpd: 2000, tpm: 2000000 };
          } else if (version >= 2) {
            limits = { rpm: 10, rpd: 1500, tpm: 1000000 };
          }

          return {
            id,
            name: m.displayName || id,
            limits,
            version,
            isFlash: id.includes('flash') || id.includes('lite')
          };
        });

      console.group("Gemini API Teşhis");
      console.log("Ham API Yanıtı:", data);
      console.log("Filtrelenmiş Modeller:", models);
      console.groupEnd();

      if (models.length === 0) throw new Error("Uygun metin modelleri bulunamadı.");

      // Sorting: Highest Version > Flash first > Alphabetical
      models.sort((a, b) => {
        if (b.version !== a.version) return b.version - a.version;
        if (b.isFlash !== a.isFlash) return b.isFlash ? 1 : -1;
        return a.id.localeCompare(b.id);
      });

      setServices(models);
      // Auto-select latest flash
      const bestModel = models.find(m => m.isFlash) || models[0];
      if (bestModel) setSelectedService(bestModel);
      localStorage.setItem('gemini_api_key', key);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const fetchCustomers = async (page, filters = customerFilters) => {
    setIsCustomersLoading(true)
    try {
      const { city, district, mainSectorId, subSectorId, search, company_name, email, website, status, notes } = filters;
      let params = new URLSearchParams({
        page: page.toString(),
        limit: "20"
      });
      
      if (city) params.append('city', city);
      if (district) params.append('district', district);
      if (mainSectorId) params.append('main_sector_id', mainSectorId);
      if (subSectorId) params.append('sub_sector_id', subSectorId);
      if (search) params.append('search', search);
      if (company_name) params.append('company_name', company_name);
      if (email) params.append('email', email);
      if (website) params.append('website', website);
      if (status) params.append('status', status);
      if (notes) params.append('notes', notes);

      let url = `${API_BASE}/customers?${params.toString()}`;
      console.log("Fetching customers with URL:", url);
      const resp = await fetch(url)
      const data = await resp.json()
      if (data && data.data) {
        setCustomers(data.data)
        setPagination(data.pagination || { totalPages: 0, total: 0 })
      } else {
        setCustomers([])
        setPagination({ totalPages: 0, total: 0 })
      }
      setCurrentPage(page)
    } catch (err) {
      setCustomers([])
      setPagination({ totalPages: 0, total: 0 })
    } finally {
      setIsCustomersLoading(false)
    }
  }

  const saveSelectedToDb = async (resultsToSave) => {
    if (!resultsToSave || resultsToSave.length === 0) return;
    try {
      const resp = await fetch(`${API_BASE}/customers/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(resultsToSave.map(r => ({
          ...r,
          main_sector_id: r.main_sector_id || null,
          sub_sector_id: r.sub_sector_id || null,
          main_sector: r.main_sector_name || '', // Legacy support
          sector: r.sub_sector_name || ''         // Legacy support
        })))
      });
      const data = await resp.json();
      if (resp.ok) {
        fetchCustomers(1);
        return data;
      }
    } catch (err) {
      console.error('Save error:', err);
    }
  }

  const handleDeleteCustomer = async (id) => {
    if (!confirm('Bu müşteriyi silmek istediğinize emin misiniz?')) return;
    try {
      const resp = await fetch(`${API_BASE}/customers/${id}`, { method: 'DELETE' });
      const data = await resp.json();
      if (resp.ok) {
        alert(data.message);
        fetchCustomers(currentPage);
      } else {
        alert(data.error);
      }
    } catch (err) {
      alert('Silme işlemi sırasında bir hata oluştu.');
    }
  }

  const handleAutoDiscovery = async () => {
    if (isAutoDiscovering) return;
    if (isAiLoading) return alert("Şu an başka bir AI araması devam ediyor. Lütfen bitmesini bekleyin.");
    if (!apiKey) return alert("Lütfen önce Ayarlar'dan Gemini API Key girin.");
    if (!selectedService) return alert("Lütfen bir yapay zeka modeli seçin.");

    const confirmReady = confirm("Tüm sektörler için otomatik tarama ve kayıt işlemi başlatılsın mı? Bu işlem API limitlerine göre vakit alabilir.");
    if (!confirmReady) return;

    setIsAutoDiscovering(true);
    const tasks = [];
    (allSectors || []).forEach(main => {
      const subSectors = main.sub_sectors || [];
      console.log(`[AutoDiscovery] Sektör kontrolü: ${main.name} (${subSectors.length} alt sektör)`);
      if (subSectors.length > 0) {
        subSectors.forEach(sub => {
          tasks.push({ mainId: main.id, mainName: main.name, subId: sub.id, subName: sub.name });
        });
      }
    });

    console.log(`[AutoDiscovery] Toplam hazırlanan görev sayısı: ${tasks.length}`);

    setAutoDiscoverStatus({ 
      total: tasks.length, 
      current: 0, 
      currentSector: '', 
      isSaving: false,
      startTime: Date.now(),
      estimatedTotalTime: 0
    });

    if (tasks.length === 0) {
      alert("Taranacak sektör bulunamadı. Lütfen önce 'Sektörler & Şablonlar' menüsünden sektör ekleyin.");
      setIsAutoDiscovering(false);
      return;
    }

    const systemText = "Sen profesyonel bir pazar araştırmacısısın. GÖREVİN: Sadece varlığından %100 emin olduğun, şu an aktif olarak çalışan ve KENDİNE AİT web sitesi olan gerçek şirketleri bulmak. Park halindeki alan adlarını, sahte (mock) verileri, uydurma e-postaları (örn: @email.com, @test.com) veya kapalı siteleri KESİNLİKLE dahil etme. Eğer bir şirketin gerçek e-postasını bulamıyorsan o şirketi listeye ekleme.";
    const supportsSystemInstruction = selectedService.id.startsWith('gemini-');

    let genAI;
    let model;
    try {
      genAI = new GoogleGenerativeAI(apiKey);
      const modelConfig = { model: selectedService.id };
      if (supportsSystemInstruction) {
        modelConfig.systemInstruction = systemText;
      }
      model = genAI.getGenerativeModel(modelConfig);
    } catch (err) {
      alert("AI bağlantısı kurulurken hata oluştu: " + err.message);
      setIsAutoDiscovering(false);
      return;
    }

    let errorReported = false;
    const startTimeLocal = Date.now();

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];

      // Update UI and ETC
      const now = Date.now();
      const elapsed = (now - startTimeLocal) / 1000;
      let estimatedRemaining = 0;
      
      if (i > 0) {
        const averageTimePerTask = elapsed / i;
        estimatedRemaining = Math.round(averageTimePerTask * (tasks.length - i));
      } else {
        // Initial estimate: roughly 35s per task
        estimatedRemaining = (tasks.length - i) * 35;
      }

      setAutoDiscoverStatus(prev => ({ 
        ...prev, 
        current: i + 1, 
        currentSector: task.subName, 
        isSaving: false,
        estimatedRemaining
      }));
      console.log(`[AutoDiscovery] Sektör işleniyor ${i + 1}/${tasks.length}: ${task.subName}`);

      try {
        const locationText = searchParams.city
          ? `${searchParams.city}${searchParams.district ? `/${searchParams.district}` : ''} bölgesinde`
          : "Tüm Türkiye genelinde";

        const sectorQuery = task.mainName ? `${task.mainName} ana sektörü altındaki ${task.subName}` : task.subName;
        let prompt = `${locationText} "${sectorQuery}" alanında faaliyet gösteren bulabildiğin kadar çok gerçek şirketi bul (Maksimum 40-50 adet). 
        KRİTİK: Sadece GERÇEK e-posta adreslerini yaz. Uydurma veya placeholder (@email.com, @test.com, @email2 vb.) adresleri KESİNLİKLE yazma. 
        Eğer şirketin gerçek e-postası bulunamıyorsa o şirketi listeye ekleme.
        Eğer şirketin birden fazla e-posta adresi varsa tümünü virgülle ayırarak "email" alanına yaz.
        Veri formatı (Sadece JSON listesi): [{"company_name": "...", "website": "...", "email": "email1, email2...", "city": "...", "district": "...", "phone": "...", "authorized_person": "..."}]`;

        if (!supportsSystemInstruction) {
          prompt = `${systemText}\n\n${prompt}`;
        }

        console.log(`[AutoDiscovery] Prompt gönderiliyor: ${prompt.substring(0, 100)}...`);
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        console.log(`[AutoDiscovery] AI Yanıtı alındı.`);
        const jsonMatch = text.replace(/```json|```/g, "").match(/\[\s*\{[\s\S]*\}\s*\]/);

        if (jsonMatch) {
          let data = [];
          try {
            data = JSON.parse(jsonMatch[0]);
          } catch (parseErr) {
            console.error(`[AutoDiscovery] JSON Parse Hatası (${task.subName}):`, parseErr);
            console.log("[AutoDiscovery] Hatalı Metin:", text);
            continue; // Skip this sector if parse fails
          }
          
          data = data.filter(item => {
            if (!item.email || !item.website) return false;
            const emailStr = String(item.email);
            const emails = emailStr.split(',').map(e => e.trim().toLowerCase());
            const validEmails = emails.filter(e => {
              const domain = e.split('@')[1] || '';
              const isPlaceholder = ['email.com', 'email2', 'email3', 'test.com', 'example.com', 'domain.com'].some(p => domain.includes(p));
              const hasDot = domain.includes('.');
              return e.includes('@') && hasDot && !isPlaceholder;
            });
            if (validEmails.length === 0) return false;
            item.email = validEmails.join(', ');
            return true;
          });

          if (data.length === 0) {
            console.log(`[AutoDiscovery] Sektör ${task.subName} için geçerli e-postalı firma bulunamadı.`);
            continue;
          }

          console.log(`[AutoDiscovery] AI ${data.length} adet geçerli veri döndürdü.`);

          console.log(`[AutoDiscovery] Web siteleri doğrulanıyor...`);
          const verifyResp = await fetch(`${API_BASE}/verify-websites`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ companies: data })
          });
          const liveData = await verifyResp.json();
          console.log(`[AutoDiscovery] Doğrulanmış şirket sayısı: ${liveData.length}`);

          if (liveData.length > 0) {
            console.log(`[AutoDiscovery] Veritabanına kaydediliyor...`);
            setAutoDiscoverStatus(prev => ({ ...prev, isSaving: true }));
            const saveRes = await saveSelectedToDb(liveData);
            console.log(`[AutoDiscovery] Kayıt sonucu:`, saveRes);
          }

          // Update usage stats
          setUsage(prev => ({
            ...prev,
            rpm: prev.rpm + 1,
            rpd: prev.rpd + 1,
            tpm: prev.tpm + (result.response.usageMetadata?.totalTokenCount || 0)
          }));
        } else {
          console.warn(`[AutoDiscovery] JSON formatında veri bulunamadı.`);
        }

        // Delay to avoid RPM limits - Dynamic based on model
        if (i < tasks.length - 1) {
          // If RPM is low (like Pro models), wait longer (30s), else 5s
          const waitTime = (selectedService.limits.rpm <= 2) ? 31000 : 5000;
          console.log(`[AutoDiscovery] RPM Koruyucu: ${waitTime / 1000} saniye bekleniyor...`);
          await new Promise(res => setTimeout(res, waitTime));
        }
      } catch (err) {
        console.error(`[AutoDiscovery] HATA (${task.subName}):`, err);
        if (err.message?.includes('429')) {
          setSearchStatus('Limit aşıldı, 60 saniye dinleniliyor...');
          console.log("[AutoDiscovery] 429 Alındı. 60s bekleniyor...");
          await new Promise(res => setTimeout(res, 60000)); // Hata alınca 1 dk bekle
          i--; // Aynı görevi tekrar dene
          continue;
        }
        if (!errorReported) {
          alert(`Bir hata oluştu (${task.subName}): ${err.message}`);
          errorReported = true;
          break;
        }
      }
    }

    setIsAutoDiscovering(false);
    setAutoDiscoverStatus({ total: 0, current: 0, currentSector: '', isSaving: false });
    alert(`Otomatik keşif tamamlandı! Toplam ${tasks.length} sektör tarandı.`);
  }

  const handleAiSearch = async (loopMode = false) => {
    if ((isAiLoading && !loopMode) || !apiKey || !selectedService) return;
    const randomizeParams = () => {
      let sector = searchParams.sector;
      let main = searchParams.mainSector;
      let city = searchParams.city;

      if (!sector && allSectors.length > 0) {
        const randomMain = allSectors[Math.floor(Math.random() * allSectors.length)];
        if (randomMain.sub_sectors && randomMain.sub_sectors.length > 0) {
          const randomSub = randomMain.sub_sectors[Math.floor(Math.random() * randomMain.sub_sectors.length)];
          sector = randomSub.name;
          main = randomMain.name;
        } else {
          sector = randomMain.name;
        }
      }

      if (!city) {
        city = majorCities[Math.floor(Math.random() * majorCities.length)];
      }

      return { sector, main, city };
    };

    let { sector: currentSector, main: currentMain, city: currentCity } = randomizeParams();

    if (!currentSector) return alert('Lütfen sektör alanını doldurun.');

    if (loopMode) setIsSurpriseActive(true);
    setIsAiLoading(true);
    setSearchProgress(0);
    setSearchStatus('Yapay zeka motoru hazırlanıyor...');
    if (!loopMode) setAiResults([]);

    if (loopMode) {
      setSurpriseStats({ totalFound: 0, startTime: Date.now(), avgTimePerCustomer: 0, currentStatus: 'Başlatılıyor...' });
    }

    // 1. Check if Sector Exists, If not, create it as Main Sector
    let mainSectorId = null;
    let subSectorId = null;
    let currentMainSectorName = currentMain;
    let finalSectorName = currentSector;

    const foundMain = (allSectors || []).find(m =>
      (m.sub_sectors || []).some(s => s.name?.toLowerCase() === currentSector.toLowerCase()) ||
      (m.name?.toLowerCase() === currentSector.toLowerCase())
    );

    if (foundMain) {
      mainSectorId = foundMain.id;
      currentMainSectorName = foundMain.name;
      const foundSub = (foundMain.sub_sectors || []).find(s => s.name.toLowerCase() === currentSector.toLowerCase());
      if (foundSub) {
        subSectorId = foundSub.id;
        finalSectorName = foundSub.name;
      }
    } else {
      // Create new main sector
      try {
        console.log(`[SectorAutoCreate] Sector "${finalSectorName}" not found. Creating as Main Sector...`);
        const createResp = await fetch(`${API_BASE}/main-sectors`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: finalSectorName })
        });
        
        if (createResp.ok) {
          // Refresh sectors to get the new ID
          const refreshResp = await fetch(`${API_BASE}/sectors`);
          const refreshedSectors = await refreshResp.json();
          setAllSectors(refreshedSectors);
          
          const newMain = refreshedSectors.find(m => m.name.toLowerCase() === finalSectorName.toLowerCase());
          if (newMain) {
            mainSectorId = newMain.id;
            currentMainSectorName = newMain.name;
            console.log(`[SectorAutoCreate] Successfully created and retrieved: ID ${mainSectorId}`);
          }
        }
      } catch (err) {
        console.error("Auto-sector creation failed:", err);
      }
    }

    // Progress Simulation
    let progressInterval = null;
    if (!loopMode) {
      progressInterval = setInterval(() => {
        setSearchProgress(prev => {
          if (prev >= 95) return prev;
          const inc = prev < 30 ? 2 : prev < 70 ? 0.5 : 0.1;
          return prev + inc;
        });
      }, 200);
    }

    const maxRetries = 2;
    let retryCount = 0;

    const runAi = async () => {
      try {
        const locationText = currentCity
          ? `${currentCity}${searchParams.district ? `/${searchParams.district}` : ''} bölgesinde`
          : "Tüm Türkiye genelinde";

        setSearchStatus(`${locationText} ${finalSectorName} firmaları taranıyor...`);
        const systemText = "Sen profesyonel bir pazar araştırmacısısın. KESİN KURAL: Sadece gerçekte var olan ve AKTİF bir web sitesine sahip şirketleri listele.";
        const supportsSystemInstruction = selectedService.id.startsWith('gemini-');

        const genAI = new GoogleGenerativeAI(apiKey)
        const modelConfig = { model: selectedService.id };
        if (supportsSystemInstruction) {
          modelConfig.systemInstruction = systemText;
        }
        const model = genAI.getGenerativeModel(modelConfig)

        const sectorQuery = currentMainSectorName
          ? `${currentMainSectorName} ana sektörü altındaki ${finalSectorName}`
          : finalSectorName;

        const varietySeed = Math.floor(Math.random() * 10000);
        let prompt = `${locationText} "${sectorQuery}" alanında faaliyet gösteren KOBİ ölçeğindeki gerçek şirketleri bul (Maksimum 50 adet). 
        KOBİ KRİTERLERİ — Aşağıdaki özelliklere uyan şirketleri getir:
        - Çalışan sayısı tahminen 10 ile 200 arasında
        - Bölgesel veya yerel ölçekte faaliyet gösteren (ulusal zincir veya holding değil)
        - SAP, Oracle gibi kurumsal ERP sistemi kullanmayan, süreçlerini büyük ihtimalle Excel/manuel yürüten
        - LinkedIn takipçi sayısı 10.000'in altında olan (büyük marka veya kurumsal firma değil)
        - Kurucusu veya operasyon müdürü hâlâ aktif olarak işin içinde olan

        KESİNLİKLE ÇIKAR:
        - 200'den fazla çalışanı olan firmalar
        - Holding veya büyük grup şirketleri (Sabancı, Koç, Alarko vb. bağlı firmalar dahil)
        - Ulusal zincirler veya franchise yapılar
        - Halka açık (borsada işlem gören) şirketler

        KRİTİK E-POSTA KURALI: Sadece gerçek e-posta adreslerini yaz. Uydurma veya placeholder (@email.com, @test.com vb.) adresleri KESİNLİKLE yazma. Eğer şirketin gerçek e-postası yoksa o şirketi listeye ekleme. Eğer şirketin birden fazla e-posta adresi (genel, satış, yetkili, personel vb.) varsa, tümünü 'email' alanında virgülle ayırarak yaz.
        
        ÇEŞİTLİLİK NOTU (Seed: ${varietySeed}): Alfabetik veya popülerlik sırasına göre değil, daha geniş bir yelpazeden (niş alanlar dahil) farklı KOBİ'ler sun.
        
        Veri formatı (Sadece JSON listesi):
        [
          {
            "company_name": "Gerçek Şirket Adı",
            "website": "https://www.sirket.com",
            "email": "email1@sirket.com, email2@sirket.com",
            "city": "Bulunduğu Şehir",
            "district": "Bulunduğu İlçe/Bölge",
            "phone": "0XXXXXXXXXX",
            "authorized_person": "Biliniyorsa İsim"
          }
        ]`

        if (!supportsSystemInstruction) {
          prompt = `${systemText}\n\n${prompt}`;
        }

        const result = await model.generateContent(prompt)
        const text = result.response.text()

        // Robust JSON extraction to handle chatty AI
        let data = [];
        try {
          const cleanedText = text.replace(/```json|```/g, "").trim();
          const jsonMatch = cleanedText.match(/\[\s*\{[\s\S]*\}\s*\]/);
          if (jsonMatch) {
            data = JSON.parse(jsonMatch[0]);
          } else {
            throw new Error("AI geçerli bir JSON listesi döndürmedi.");
          }
        } catch (jsonErr) {
          console.error("JSON Parse Error:", jsonErr, "Original Text:", text);
          throw new Error("Veri formatı çözümlenemedi. Lütfen tekrar deneyin.");
        }

        // Filter out hallucinated emails and incomplete data
        data = data.filter(item => {
          if (!item.email || !item.website) return false;
          const emails = item.email.split(',').map(e => e.trim().toLowerCase());
          const validEmails = emails.filter(e => {
            const domain = e.split('@')[1] || '';
            const isPlaceholder = ['email.com', 'email2', 'email3', 'test.com', 'example.com', 'domain.com'].some(p => domain.includes(p));
            const hasDot = domain.includes('.');
            return e.includes('@') && hasDot && !isPlaceholder;
          });
          if (validEmails.length === 0) return false;
          item.email = validEmails.join(', ');
          return true;
        });

        if (data.length === 0) {
          if (loopMode) {
            setSearchStatus('Uygun firma bulunamadı, sonrakine geçiliyor...');
            return;
          }
          throw new Error("Geçerli e-posta adresine sahip firma bulunamadı. Lütfen aramayı daraltın veya tekrar deneyin.");
        }

        // Map data with DB IDs — IDs drive the relational model, names are display-only
        data = data.map(item => ({
          ...item,
          main_sector_id: mainSectorId,
          sub_sector_id: subSectorId,
          main_sector_name: currentMainSectorName || '',
          sub_sector_name: finalSectorName || ''
        }));

        setSearchStatus('Web siteleri canlı olarak doğrulanıyor...');
        setSearchProgress(80);

        const verifyResp = await fetch(`${API_BASE}/verify-websites`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companies: data })
        });
        const liveData = await verifyResp.json();

        setUsage(prev => ({
          ...prev,
          rpm: prev.rpm + 1,
          rpd: prev.rpd + 1,
          tpm: prev.tpm + (result.response.usageMetadata?.totalTokenCount || 0)
        }));

        if (loopMode) {
          setSearchStatus(`${liveData.length} yeni şirket kaydediliyor...`);
          await saveSelectedToDb(liveData);
          setSurpriseStats(prev => {
            const newTotal = prev.totalFound + liveData.length;
            const elapsed = (Date.now() - prev.startTime) / 1000;
            return {
              ...prev,
              totalFound: newTotal,
              avgTimePerCustomer: newTotal > 0 ? (elapsed / newTotal).toFixed(1) : 0,
              currentStatus: `${liveData.length} yeni şirket eklendi.`
            };
          });
        } else {
          setAiResults(liveData)
          setSelectedForDb(new Set())
          setSearchProgress(100);
          setSearchStatus('Tamamlandı!');
        }

        if (liveData.length === 0 && !loopMode) {
          alert('AI sonuçları doğrulanamadı. Lütfen farklı bir arama yapın.');
        }
      } catch (err) {
        if (err.message?.includes('429')) {
          if (retryCount < maxRetries) {
            retryCount++;
            const waitTime = retryCount * 10000;
            setSearchStatus(`Sistem meşgul (429), ${waitTime / 1000} sn sonra tekrar denenecek...`);
            await new Promise(res => setTimeout(res, waitTime));
            return runAi();
          } else {
            const isDaily = err.message.toLowerCase().includes('daily') || err.message.toLowerCase().includes('quota');
            throw new Error(isDaily
              ? "Günlük kullanım sınırınıza ulaştınız. Lütfen yarın tekrar deneyin veya farklı bir API Key kullanın."
              : "Çok sık istek yapıldı. Lütfen model listesinden 'gemini-1.5-flash' seçip 1 dakika bekleyerek deneyin.");
          }
        }
        throw err;
      }
    };

    try {
      if (loopMode) {
        // Infinite Loop
        while (true) {
          // Re-randomize for variety if loop is active
          if (loopMode && !searchParams.sector) {
            const nextParams = randomizeParams();
            currentSector = nextParams.sector;
            currentMain = nextParams.main;
            currentCity = nextParams.city;
            
            // Re-evalute IDs for the new random sector
            const foundM = (allSectors || []).find(m =>
              (m.sub_sectors || []).some(s => s.name?.toLowerCase() === currentSector.toLowerCase()) ||
              (m.name?.toLowerCase() === currentSector.toLowerCase())
            );
            if (foundM) {
              mainSectorId = foundM.id;
              currentMainSectorName = foundM.name;
              const foundS = (foundM.sub_sectors || []).find(s => s.name.toLowerCase() === currentSector.toLowerCase());
              if (foundS) {
                subSectorId = foundS.id;
                finalSectorName = foundS.name;
              } else {
                subSectorId = null;
                finalSectorName = foundM.name;
              }
            }
          }
          
          try {
            await runAi();
          } catch (loopErr) {
            console.error("Loop iteration failed:", loopErr);
            setSearchStatus(`Hata oluştu, bekleniyor: ${loopErr.message}`);
            // If it's a quota error, we might want to wait longer or stop
            if (loopErr.message?.includes('sınırınıza ulaştınız')) {
              alert(loopErr.message);
              break;
            }
            await new Promise(res => setTimeout(res, 30000)); // Wait 30s on error
          }
          
          // Wait a bit between iterations to avoid spamming
          setSearchStatus('Mola veriliyor, devam edilecek...');
          await new Promise(res => setTimeout(res, 5000));
          
          if (window._stopSurprise) {
            window._stopSurprise = false;
            break;
          }
        }
      } else {
        await runAi();
      }
    } catch (err) {
      alert('AI Hatası: ' + err.message);
    } finally {
      if (progressInterval) clearInterval(progressInterval);
      setIsAiLoading(false);
      setIsSurpriseActive(false);
    }
  }

  const toggleSelection = (index) => {
    const newSelection = new Set(selectedForDb)
    if (newSelection.has(index)) newSelection.delete(index)
    else newSelection.add(index)
    setSelectedForDb(newSelection)
  }

  const toggleCustomerSelection = (id) => {
    const newSelection = new Set(selectedCustomers)
    if (newSelection.has(id)) newSelection.delete(id)
    else newSelection.add(id)
    setSelectedCustomers(newSelection)
  }

  const getMailContent = (customer, subSectors) => {
    const matchingSub = subSectors.find(s =>
      s.id === customer.sub_sector_id ||
      s.name?.toLowerCase() === customer.sub_sector_name?.toLowerCase()
    );

    let subject = `İş Birliği Teklifi`;
    let content = `Sayın Yetkili,\n\n${customer.company_name} firması ile yazılım danışmanlığı süreçleri hakkında görüşmek istiyoruz.\n\nİyi çalışmalar.`;

    if (matchingSub && (matchingSub.mail_template || matchingSub.mail_subject)) {
      const companyName = customer.company_name || 'Değerli Firma';
      subject = (matchingSub.mail_subject || subject).replace(/{{Firma_Adı}}/g, companyName);
      content = (matchingSub.mail_template || content).replace(/{{Firma_Adı}}/g, companyName);
    }

    return { subject, content };
  }

  const handleBulkMail = async () => {
    if (selectedCustomers.size === 0) return alert("Lütfen mail gönderilecek müşterileri seçin.");
    if (!googleStatus.authenticated) return alert("Lütfen önce Google ile Bağlanın.");
    if (!confirm(`${selectedCustomers.size} seçili müşteriye mailler sırayla gönderilsin mi?`)) return;

    setBulkSending({ active: true, current: 0, total: selectedCustomers.size, status: 'Başlatılıyor...' });
    const customerList = customers.filter(c => selectedCustomers.has(c.id));
    const allSubs = (allSectors || []).flatMap(m => m.sub_sectors || []);

    let count = 0;
    for (const customer of customerList) {
      count++;
      setBulkSending(prev => ({ ...prev, current: count, status: `${customer.company_name} - Gönderiliyor...` }));

      const { subject, content } = getMailContent(customer, allSubs);

      try {
        const resp = await fetch(`${API_BASE}/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: customer.email,
            subject: subject,
            html: content.replace(/\n/g, '<br>'),
            customerId: customer.id
          })
        });

        if (!resp.ok) console.error(`Failed to send mail to ${customer.email}`);

        // Wait a small bit between sends to avoid rate limits
        await new Promise(r => setTimeout(r, 1000));
      } catch (err) {
        console.error("Bulk send error for", customer.company_name, err);
      }
    }

    setBulkSending({ active: false, current: 0, total: 0, status: '' });
    setSelectedCustomers(new Set());
    alert("Toplu gönderim tamamlandı.");
    fetchCustomers(currentPage);
  }

  const handleClearCustomers = async () => {
    const password = prompt("Lütfen yönetici şifresini giriniz:");
    if (!password) return;

    if (!confirm("Tüm müşteri listesi kalıcı olarak silinecektir. Emin misiniz?")) return;

    try {
      const resp = await fetch(`${API_BASE}/customers/clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      const data = await resp.json();
      if (resp.ok) {
        alert(data.message);
        fetchCustomers(1);
      } else {
        alert(data.error || "Bir hata oluştu.");
      }
    } catch (err) {
      console.error("Clear error:", err);
      alert("Sunucu bağlantı hatası: " + err.message);
    }
  }

  const saveSelectedToDbFromUi = async () => {
    const toSave = aiResults.filter((_, idx) => selectedForDb.has(idx));
    if (toSave.length === 0) return alert('Lütfen eklenecek şirketleri seçin.');

    const res = await saveSelectedToDb(toSave);
    if (res && res.status === 'success') {
      alert(res.message);
      setAiResults([]);
      setSelectedForDb(new Set());
    } else if (res) {
      alert(res.message);
    } else {
      alert('Kaydetme işlemi sırasında bir hata oluştu.');
    }
  }

  const filteredSectors = (allSectors || []).map(main => ({
    ...main,
    sub_sectors: (main.sub_sectors || []).filter(sub =>
      (sub.name || '').toLowerCase().includes((searchParams.sector || '').toLowerCase()) ||
      (main.name || '').toLowerCase().includes((searchParams.sector || '').toLowerCase())
    )
  })).filter(main => (main.sub_sectors || []).length > 0)

  return (
    <div className={`main-layout ${isSidebarOpen ? 'sidebar-open' : ''}`}>
      {/* Sidebar Toggle Button */}
      <button
        className={`sidebar-toggle-btn ${isSidebarOpen ? 'sidebar-open' : ''}`}
        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
        title={isSidebarOpen ? "Menüyü Kapat" : "Menüyü Aç"}
      >
        {isSidebarOpen ? <ChevronLeft size={24} /> : <Menu size={24} />}
      </button>

      <aside className={`app-sidebar ${isSidebarOpen ? 'show' : ''}`}>
        <div className="sidebar-header">
          <div className="branding">
            <img src="/logo.png" alt="Oliworks Logo" className="logo-img" />
          </div>
          <button className="sidebar-close-inner" onClick={() => setIsSidebarOpen(false)} title="Menüyü Kapat">
            <ChevronLeft size={20} />
          </button>
        </div>

        <div className="sidebar-content">
          <div className="sidebar-group">
            <h3 className="group-title">Sistem Durumu</h3>
            <div className="status-chips">
              <div className={`status-chip ${apiKey ? 'active' : ''}`}>
                <Zap size={18} strokeWidth={2} /> AI: {apiKey ? 'Aktif' : 'Pasif'}
              </div>
              <div className={`status-chip ${dbStatus.connected ? 'active' : ''}`}>
                <Database size={18} strokeWidth={2} /> SQL: {dbStatus.connected ? 'Bağlı' : 'Hata'}
              </div>
            </div>
          </div>

          <div className="sidebar-group">
            <h3 className="group-title">Google Mail</h3>
            <div className="google-auth-section">
              {googleStatus.authenticated ? (
                <div className="google-logged-in-container">
                  <div className="status-chip active google-active">
                    <CheckCircle size={18} strokeWidth={2} />
                    <span className="email-text">{googleStatus.email}</span>
                  </div>
                  <button className="google-logout-btn" onClick={handleGoogleLogout} title="Çıkış Yap">
                    <LogOut size={16} />
                  </button>
                </div>
              ) : (
                <button className="google-login-btn" onClick={handleGoogleLogin}>
                  <MailIcon size={18} strokeWidth={2} />
                  <span>Google ile Bağlan</span>
                </button>
              )}
            </div>
          </div>

          <div className="sidebar-group">
            <h3 className="group-title">Aktif Model</h3>
            <div className="model-dropdown-container">
              <div
                className={`model-selector-box interactive ${isDropdownOpen ? 'open' : ''}`}
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              >
                <Cpu size={18} strokeWidth={2} />
                <span>{selectedService ? selectedService.name : 'Model Seçilmedi'}</span>
                <ChevronDown size={18} strokeWidth={2} className={`chevron ${isDropdownOpen ? 'rotated' : ''}`} />
              </div>

              {isDropdownOpen && (
                <div className="model-options-list">
                  {services.map(service => (
                    <div
                      key={service.id}
                      className={`model-option ${selectedService?.id === service.id ? 'active' : ''}`}
                      onClick={() => {
                        setSelectedService(service);
                        setIsDropdownOpen(false);
                      }}
                    >
                      <span className="option-name">{service.name}</span>
                      <span className="option-id">{service.id}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="sidebar-group">
            <h3 className="group-title">Yönetim</h3>
            <button className="admin-clear-btn" onClick={handleClearCustomers}>
              <Trash2 size={18} />
              <span>Listeyi Temizle</span>
            </button>
          </div>

          <div className="sidebar-group">
            <div className="group-header-with-action">
              <h3 className="group-title">Kullanım Limitleri</h3>
              <button
                className="text-reset-btn"
                onClick={() => setUsage({ rpm: 0, rpd: 0, tpm: 0, lastUpdate: new Date().toLocaleDateString('en-CA') })}
                title="İstatistikleri Sıfırla"
              >
                <RefreshCw size={12} />
              </button>
            </div>
            {selectedService && (
              <div className="mini-stats">
                <div className="mini-stat-item">
                  <div className="stat-info">
                    <span>RPM (Dakika)</span>
                    <strong>{usage.rpm} / {selectedService.limits.rpm}</strong>
                  </div>
                  <div className="mini-progress"><div className="bar" style={{ width: `${Math.min(100, (usage.rpm / selectedService.limits.rpm) * 100)}%` }}></div></div>
                </div>
                <div className="mini-stat-item">
                  <div className="stat-info">
                    <span>RPD (Günlük)</span>
                    <strong>{usage.rpd} / {selectedService.limits.rpd}</strong>
                  </div>
                  <div className="mini-progress"><div className="bar green" style={{ width: `${Math.min(100, (usage.rpd / selectedService.limits.rpd) * 100)}%` }}></div></div>
                </div>
                <div className="mini-stat-item">
                  <div className="stat-info">
                    <span>TPM (Token)</span>
                    <strong>{(usage.tpm / 1000).toFixed(1)}k / {(selectedService.limits.tpm / 1000).toFixed(0)}k</strong>
                  </div>
                  <div className="mini-progress"><div className="bar purple" style={{ width: `${Math.min(100, (usage.tpm / selectedService.limits.tpm) * 100)}%` }}></div></div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-group">
            <button className="menu-item-btn" onClick={() => setIsSectorModalOpen(true)}>
              <Layout size={18} strokeWidth={2} /> Sektörler & Şablonlar
            </button>
          </div>

          <button className="settings-btn" onClick={() => setIsSettingsOpen(true)}>
            <Settings size={18} strokeWidth={2} /> Ayarlar
          </button>
        </div>
      </aside>

      {/* Main Container - Right Section */}
      <div className="content-area">
        <header className="content-header">
          <div className="search-inputs">
            <div className="input-field">
              <label>İl</label>
              <input
                placeholder="Örn: İstanbul"
                value={searchParams.city}
                onChange={e => setSearchParams({ ...searchParams, city: e.target.value })}
              />
            </div>
            <div className="input-field">
              <label>İlçe</label>
              <input
                placeholder="Örn: Şişli"
                value={searchParams.district}
                onChange={e => setSearchParams({ ...searchParams, district: e.target.value })}
              />
            </div>
            <div className="input-field searchable-dropdown">
              <label>Sektör</label>
              <input
                placeholder="Sektör Ara..."
                value={searchParams.sector}
                onFocus={() => setIsSectorDropdownOpen(true)}
                onChange={e => setSearchParams({ ...searchParams, sector: e.target.value, mainSector: '' })}
              />
              {isSectorDropdownOpen && (
                <div className="dropdown-popover">
                  {filteredSectors.length > 0 ? (
                    filteredSectors.map(main => (
                      <div key={main.id} className="dropdown-group">
                        <div className="group-header">{main.name}</div>
                        {main.sub_sectors.map(sub => (
                          <div
                            key={sub.id}
                            className={`dropdown-item ${searchParams.sector === sub.name ? 'selected' : ''}`}
                            onClick={() => {
                              setSearchParams({ ...searchParams, sector: sub.name, mainSector: main.name });
                              setIsSectorDropdownOpen(false);
                            }}
                          >
                            {sub.name}
                            {searchParams.sector === sub.name && <CheckCircle size={14} color="var(--blue)" />}
                          </div>
                        ))}
                      </div>
                    ))
                  ) : (
                    <div className="no-results">Sektör bulunamadı.</div>
                  )}
                </div>
              )}
            </div>
          </div>

          <button 
            className={`surprise-btn ${isSurpriseActive ? 'active-loop' : ''}`} 
            onClick={() => {
              if (isSurpriseActive) {
                window._stopSurprise = true;
                setIsSurpriseActive(false);
              } else {
                handleAiSearch(true);
              }
            }} 
            disabled={isAiLoading && !isSurpriseActive}
          >
            {isSurpriseActive ? <X size={18} strokeWidth={2} /> : <Sparkles size={18} strokeWidth={2} />}
            <span>{isSurpriseActive ? 'Durdur' : 'Şaşırt Beni'}</span>
          </button>
          <button
            className={`auto-discovery-btn ${isAutoDiscovering ? 'active' : ''}`}
            onClick={handleAutoDiscovery}
            disabled={isAiLoading || isAutoDiscovering}
          >
            {isAutoDiscovering ? <RefreshCw className="spin" size={18} /> : <Zap size={18} />}
            <span>{isAutoDiscovering ? `${autoDiscoverStatus.current}/${autoDiscoverStatus.total} - ${autoDiscoverStatus.currentSector}` : 'Otomatik Keşif'}</span>
          </button>
        </header>

        {isAutoDiscovering && (
          <div className="discovery-progress-overlay">
            <div className="discovery-modal">
              <Zap className="spin-slow" size={48} color="#d1ff37" />
              <h2>Otomatik Keşif Devam Ediyor</h2>
              <p>Türkiye genelindeki tüm sektörler taranıyor ve listeye ekleniyor...</p>
              <div className="sector-badge">{autoDiscoverStatus.currentSector}</div>
              <div className="progress-container">
                <div className="progress-track">
                  <div className="progress-bar" style={{ width: `${(autoDiscoverStatus.current / autoDiscoverStatus.total) * 100}%` }}></div>
                </div>
                <div className="progress-stats">
                  <span>{autoDiscoverStatus.current} / {autoDiscoverStatus.total} Sektör</span>
                  {autoDiscoverStatus.estimatedRemaining > 0 && (
                    <span className="etc-label">
                      Tahmini Kalan: {Math.floor(autoDiscoverStatus.estimatedRemaining / 60)} dk {autoDiscoverStatus.estimatedRemaining % 60} sn
                    </span>
                  )}
                </div>
              </div>
              {autoDiscoverStatus.isSaving && (
                <div className="saving-badge">Veritabanına kaydediliyor...</div>
              )}
            </div>
          </div>
        )}

        {isSurpriseActive && (
          <div className="discovery-progress-overlay">
            <div className="discovery-modal surprise-mode">
              <Sparkles className="spin-slow" size={48} color="#d1ff37" />
              <h2>Şaşırt Beni Modu Aktif</h2>
              <p>Bulabildiğim kadar çok müşteri bulmaya devam ediyorum...</p>
              
              <div className="surprise-stats-grid">
                <div className="s-stat">
                  <label>Bulunan</label>
                  <span>{surpriseStats.totalFound}</span>
                </div>
                <div className="s-stat">
                  <label>Geçen Süre</label>
                  <span>{Math.floor((Date.now() - (surpriseStats.startTime || Date.now())) / 1000)} sn</span>
                </div>
                <div className="s-stat">
                  <label>Hız (1 Müşteri)</label>
                  <span>{surpriseStats.avgTimePerCustomer} sn</span>
                </div>
              </div>
              
              <div className="sector-badge">{surpriseStats.currentStatus}</div>
              
              <button className="stop-loop-btn" onClick={() => { window._stopSurprise = true; setIsSurpriseActive(false); }}>
                Yeterli, Durdur
              </button>
            </div>
          </div>
        )}

        {/* AI Results Table */}
        <section className="results-section">
          <div className="section-header">
            <h2>AI Sonuçları ({aiResults.length})</h2>
            {aiResults.length > 0 && (
              <button className="add-to-db-btn" onClick={saveSelectedToDbFromUi}>
                <Plus size={16} strokeWidth={2} /> Seçilenleri Listeye Ekle ({selectedForDb.size})
              </button>
            )}
          </div>

          <div className="table-wrapper">
            {isAiLoading ? (
              <div className="table-placeholder progress-mode">
                <RefreshCw className="spin" size={40} strokeWidth={2} />
                <div className="progress-container">
                  <div className="progress-info">
                    <span className="status-text">{searchStatus}</span>
                    <span className="percent-text">%{Math.round(searchProgress)}</span>
                  </div>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${searchProgress}%` }}></div>
                  </div>
                  <p className="eta-text">Tahmini kalan süre: {searchProgress < 80 ? '15-20 sn' : '2-5 sn'}</p>
                </div>
              </div>
            ) : aiResults.length === 0 ? (
              <div className="table-placeholder">
                <Sparkles size={32} strokeWidth={2} />
                <p>Arama yaparak AI önerilerini burada görüntüleyin</p>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th width="40">
                      <div
                        className={`checkbox small ${aiResults.length > 0 && selectedForDb.size === aiResults.length ? 'checked' : ''}`}
                        onClick={() => {
                          if (selectedForDb.size === aiResults.length) setSelectedForDb(new Set());
                          else setSelectedForDb(new Set(aiResults.map((_, i) => i)));
                        }}
                      ></div>
                    </th>
                    <th>Şirket Adı</th>
                    <th>Ana Sektör</th>
                    <th>Alt Sektör</th>
                    <th>Web Sitesi</th>
                    <th>Mail</th>
                    <th>Konum</th>
                  </tr>
                </thead>
                <tbody>
                  {aiResults.map((item, idx) => (
                    <tr key={idx} className={selectedForDb.has(idx) ? 'selected-row' : ''} onClick={() => toggleSelection(idx)}>
                      <td><div className={`checkbox ${selectedForDb.has(idx) ? 'checked' : ''}`}></div></td>
                      <td>{item.company_name}</td>
                      <td><span className="badge navy">{item.main_sector_name}</span></td>
                      <td><span className="badge">{item.sub_sector_name}</span></td>
                      <td><a href={item.website} target="_blank" rel="noopener noreferrer" className="table-link">{item.website}</a></td>
                      <td>{item.email}</td>
                      <td>{item.city} / {item.district}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="customers-section">
          <div className="section-header">
            <div className="title-with-count">
              <h2>Müşteri Listesi ({pagination.total}) {isCustomersLoading && <RefreshCw className="spin" size={18} style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: '10px' }} />}</h2>
              <button className="add-manual-btn" onClick={() => { setSelectedCustomerForEdit(null); setIsCustomerModalOpen(true); }}>
                <Plus size={16} /> Manuel Ekle
              </button>
            </div>
            <div className="list-filters">
              <button
                className={`bulk-mail-btn ${selectedCustomers.size > 0 ? 'active' : ''}`}
                onClick={handleBulkMail}
                disabled={bulkSending.active}
              >
                {bulkSending.active ? (
                  <RefreshCw className="spin" size={16} />
                ) : (
                  <Send size={16} />
                )}
                <span>Toplu Mail ({selectedCustomers.size})</span>
              </button>
            </div>
          </div>

          {bulkSending.active && (
            <div className="bulk-progress-bar">
              <div className="progress-info">
                <span>{bulkSending.status}</span>
                <span>{bulkSending.current} / {bulkSending.total}</span>
              </div>
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{ width: `${(bulkSending.current / bulkSending.total) * 100}%` }}
                ></div>
              </div>
            </div>
          )}

          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th width="40">
                    <div
                      className={`checkbox small ${customers.length > 0 && selectedCustomers.size === customers.length ? 'checked' : ''}`}
                      onClick={() => {
                        if (selectedCustomers.size === customers.length) setSelectedCustomers(new Set());
                        else setSelectedCustomers(new Set(customers.map(c => c.id)));
                      }}
                    ></div>
                  </th>
                  <th>Şirket Adı</th>
                  <th>Sektör</th>
                  <th>Alt Sektör</th>
                  <th>Web Sitesi</th>
                  <th>Mail</th>
                  <th>Konum</th>
                  <th>Son Mail</th>
                  <th>Durum</th>
                  <th>Notlar</th>
                  <th width="50">İşlem</th>
                </tr>
                <tr className="filter-row">
                  <th></th>
                  <th>
                    <input 
                      className="column-filter"
                      placeholder="Şirket ara..."
                      value={customerFilters.company_name}
                      onChange={e => setCustomerFilters(prev => ({ ...prev, company_name: e.target.value }))}
                    />
                  </th>
                  <th>
                    <select
                      className="column-filter"
                      value={customerFilters.mainSectorId}
                      onChange={e => setCustomerFilters(prev => ({ ...prev, mainSectorId: e.target.value, subSectorId: '' }))}
                    >
                      <option value="">Tümü</option>
                      {allSectors.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </th>
                  <th>
                    <select
                      className="column-filter"
                      value={customerFilters.subSectorId}
                      onChange={e => setCustomerFilters(prev => ({ ...prev, subSectorId: e.target.value }))}
                      disabled={!customerFilters.mainSectorId}
                    >
                      <option value="">Tümü</option>
                      {(allSectors.find(s => String(s.id) === String(customerFilters.mainSectorId))?.sub_sectors || []).map(ss => (
                        <option key={ss.id} value={ss.id}>{ss.name}</option>
                      ))}
                    </select>
                  </th>
                  <th>
                    <input 
                      className="column-filter"
                      placeholder="Web sitesi..."
                      value={customerFilters.website}
                      onChange={e => setCustomerFilters(prev => ({ ...prev, website: e.target.value }))}
                    />
                  </th>
                  <th>
                    <input 
                      className="column-filter"
                      placeholder="Mail ara..."
                      value={customerFilters.email}
                      onChange={e => setCustomerFilters(prev => ({ ...prev, email: e.target.value }))}
                    />
                  </th>
                  <th>
                    <div className="dual-filter">
                      <input 
                        className="column-filter half"
                        placeholder="İl..."
                        value={customerFilters.city}
                        onChange={e => setCustomerFilters(prev => ({ ...prev, city: e.target.value }))}
                      />
                      <input 
                        className="column-filter half"
                        placeholder="İlçe..."
                        value={customerFilters.district}
                        onChange={e => setCustomerFilters(prev => ({ ...prev, district: e.target.value }))}
                      />
                    </div>
                  </th>
                  <th></th>
                  <th>
                    <select
                      className="column-filter"
                      value={customerFilters.status}
                      onChange={e => setCustomerFilters(prev => ({ ...prev, status: e.target.value }))}
                    >
                      <option value="">Tümü</option>
                      <option value="New Lead">New Lead</option>
                      <option value="Contacted Call">Contacted Call</option>
                      <option value="Contacted Mail">Contacted Mail</option>
                      <option value="No Response">No Response</option>
                      <option value="Interested">Interested</option>
                      <option value="Meeting Scheduled">Meeting Scheduled</option>
                      <option value="Proposal Sent">Proposal Sent</option>
                      <option value="Closed Won">Closed Won</option>
                      <option value="Closed Lost">Closed Lost</option>
                    </select>
                  </th>
                  <th>
                    <input 
                      className="column-filter"
                      placeholder="Notlarda ara..."
                      value={customerFilters.notes}
                      onChange={e => setCustomerFilters(prev => ({ ...prev, notes: e.target.value }))}
                    />
                  </th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {customers
                  .map((c, i) => (
                    <tr key={c.id || i} className={selectedCustomers.has(c.id) ? 'selected-row' : ''}>
                      <td onClick={(e) => { e.stopPropagation(); toggleCustomerSelection(c.id); }}>
                        <div className={`checkbox ${selectedCustomers.has(c.id) ? 'checked' : ''}`}></div>
                      </td>
                      <td><strong>{c.company_name}</strong></td>
                      <td><span className="badge navy">{c.main_sector_name}</span></td>
                      <td><span className="badge teal">{c.sub_sector_name}</span></td>
                      <td><a href={c.website} target="_blank" rel="noopener noreferrer" className="table-link">{c.website}</a></td>
                      <td>{c.email}</td>
                      <td>{c.city} / {c.district}</td>
                      <td>
                        {c.last_mail_at ? (
                          <span className="last-mail-tag">
                            {new Date(c.last_mail_at).toLocaleDateString('tr-TR')} {new Date(c.last_mail_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        ) : '-'}
                      </td>
                      <td>
                        <select
                          value={c.status || 'New Lead'}
                          onChange={async (e) => {
                            const newStatus = e.target.value;
                            // Optimistic Update
                            setCustomers(prev => prev.map(cust =>
                              cust.id === c.id ? { ...cust, status: newStatus } : cust
                            ));

                            try {
                              const resp = await fetch(`${API_BASE}/customers/${c.id}/status`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ status: newStatus })
                              });
                              if (!resp.ok) {
                                // Rollback if error
                                fetchCustomers(currentPage);
                                alert("Durum güncellenemedi.");
                              }
                            } catch (err) {
                              console.error("Status update error:", err);
                              fetchCustomers(currentPage);
                            }
                          }}
                          className={`status-badge-select ${c.status?.replace(/ /g, '-').toLowerCase() || 'new-lead'}`}
                        >
                          <option value="New Lead">New Lead</option>
                          <option value="Contacted Call">Contacted Call</option>
                          <option value="Contacted Mail">Contacted Mail</option>
                          <option value="No Response">No Response</option>
                          <option value="Interested">Interested</option>
                          <option value="Meeting Scheduled">Meeting Scheduled</option>
                          <option value="Proposal Sent">Proposal Sent</option>
                          <option value="Closed Won">Closed Won</option>
                          <option value="Closed Lost">Closed Lost</option>
                        </select>
                      </td>
                      <td>
                        {c.notes ? (
                          <div className="notes-indicator" title={c.notes}>
                            <MessageSquare size={16} />
                            <span>{c.notes.substring(0, 20)}{c.notes.length > 20 ? '...' : ''}</span>
                          </div>
                        ) : '-'}
                      </td>
                      <td className="actions-cell">
                        <button className="action-icon-btn mail" title="Mail Gönder" onClick={() => setSelectedMailCustomer(c)}>
                          <MailIcon size={16} strokeWidth={2} />
                        </button>
                        <button className="action-icon-btn edit" title="Düzenle" onClick={() => { setSelectedCustomerForEdit(c); setIsCustomerModalOpen(true); }}>
                          <Pencil size={16} strokeWidth={2} />
                        </button>
                        <button className="action-icon-btn delete" title="Sil" onClick={() => handleDeleteCustomer(c.id)}>
                          <Trash2 size={16} strokeWidth={2} />
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <button disabled={currentPage === 1} onClick={() => fetchCustomers(currentPage - 1)}>
              <ChevronLeft size={16} strokeWidth={2} />
            </button>
            <span>Sayfa {currentPage} / {pagination.totalPages || 1}</span>
            <button disabled={currentPage === pagination.totalPages} onClick={() => fetchCustomers(currentPage + 1)}>
              <ChevronRight size={16} strokeWidth={2} />
            </button>
          </div>
        </section>
      </div>

      {
        isSettingsOpen && (
          <SettingsModal
            onClose={() => setIsSettingsOpen(false)}
            onSave={(key) => { setApiKey(key); setIsSettingsOpen(false) }}
            initialApiKey={apiKey}
          />
        )
      }

      {
        selectedMailCustomer && (
          <MailModal
            customer={selectedMailCustomer}
            apiKey={apiKey}
            selectedModel={selectedService?.id || 'gemini-1.5-flash'}
            onClose={() => setSelectedMailCustomer(null)}
            onMailSent={() => fetchCustomers(currentPage)}
            subSectors={(allSectors || []).flatMap(m => m.sub_sectors || [])}
          />
        )
      }

      {
        isSectorModalOpen && (
          <SectorManagementModal
            onClose={() => {
              setIsSectorModalOpen(false)
              fetchSectors()
            }}
          />
        )
      }
      {
        isCustomerModalOpen && (
          <CustomerModal
            customer={selectedCustomerForEdit}
            onClose={() => setIsCustomerModalOpen(false)}
            onSave={() => fetchCustomers(currentPage)}
            allSectors={allSectors}
          />
        )
      }
    </div >
  )
}

export default App
