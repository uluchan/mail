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
  const [customerFilters, setCustomerFilters] = useState({ city: '', mainSectorId: '', subSectorId: '', search: '' })

  // Search Parameters & Results
  const [searchParams, setSearchParams] = useState({ city: '', district: '', sector: '', mainSector: '' })
  const [aiResults, setAiResults] = useState([])
  const [isAiLoading, setIsAiLoading] = useState(false)
  const [searchProgress, setSearchProgress] = useState(0)
  const [searchStatus, setSearchStatus] = useState('')
  const [selectedForDb, setSelectedForDb] = useState(new Set())
  const [isAutoDiscovering, setIsAutoDiscovering] = useState(false)
  const [autoDiscoverStatus, setAutoDiscoverStatus] = useState({ total: 0, current: 0, currentSector: '' })

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

      const resp = await fetch(`${API_BASE}/auth/google/url?redirectUri=${encodeURIComponent(redirectUri)}`)
      const { url } = await resp.json()
      const width = 600, height = 700;
      const left = (window.innerWidth / 2) - (width / 2);
      const top = (window.innerHeight / 2) - (height / 2);
      const authWindow = window.open(url, 'Google Login', `width=${width},height=${height},left=${left},top=${top}`);

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
      const { city, mainSectorId, subSectorId, search } = filters;
      let url = `${API_BASE}/customers?page=${page}&limit=20`;
      if (city) url += `&city=${encodeURIComponent(city)}`;
      if (mainSectorId) url += `&main_sector_id=${mainSectorId}`;
      if (subSectorId) url += `&sub_sector_id=${subSectorId}`;
      if (search) url += `&search=${encodeURIComponent(search)}`;

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

    setAutoDiscoverStatus({ total: tasks.length, current: 0, currentSector: '', isSaving: false });

    if (tasks.length === 0) {
      alert("Taranacak sektör bulunamadı. Lütfen önce 'Sektörler & Şablonlar' menüsünden sektör ekleyin.");
      setIsAutoDiscovering(false);
      return;
    }

    // Initialize AI once outside the loop
    let genAI;
    let model;
    try {
      genAI = new GoogleGenerativeAI(apiKey);
      model = genAI.getGenerativeModel({
        model: selectedService.id,
        systemInstruction: "Sen profesyonel bir pazar araştırmacısısın. KESİN KURAL: Sadece gerçekte var olan ve AKTİF bir web sitesine sahip şirketleri listele."
      });
    } catch (err) {
      alert("AI bağlantısı kurulurken hata oluştu: " + err.message);
      setIsAutoDiscovering(false);
      return;
    }

    let errorReported = false;
    let isActuallyDiscovering = true; // Use this to track local context

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];

      // Update UI
      setAutoDiscoverStatus(prev => ({ ...prev, current: i + 1, currentSector: task.subName, isSaving: false }));
      console.log(`[AutoDiscovery] Sektör işleniyor ${i + 1}/${tasks.length}: ${task.subName}`);

      try {
        const locationText = searchParams.city
          ? `${searchParams.city}${searchParams.district ? `/${searchParams.district}` : ''} bölgesinde`
          : "Tüm Türkiye genelinde";

        const sectorQuery = task.mainName ? `${task.mainName} ana sektörü altındaki ${task.subName}` : task.subName;
        const prompt = `${locationText} "${sectorQuery}" alanında faaliyet gösteren gerçek şirketleri bul. Maksimum 10 şirket getir. Veri formatı (Sadece JSON listesi): [{"company_name": "...", "website": "...", "email": "...", "city": "...", "district": "...", "phone": "...", "authorized_person": "..."}]`;

        console.log(`[AutoDiscovery] Prompt gönderiliyor: ${prompt.substring(0, 100)}...`);
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        console.log(`[AutoDiscovery] AI Yanıtı alındı.`);
        const jsonMatch = text.match(/\[[\s\S]*\]/);

        if (jsonMatch) {
          let data = JSON.parse(jsonMatch[0]);
          console.log(`[AutoDiscovery] AI ${data.length} adet ham veri döndürdü.`);
          data = data.map(item => ({
            ...item,
            main_sector_id: task.mainId,
            sub_sector_id: task.subId,
            main_sector_name: task.mainName,
            sub_sector_name: task.subName
          }));

          console.log(`[AutoDiscovery] Web siteleri doğrulanıyor...`);
          const verifyResp = await fetch('http://localhost:3001/api/verify-websites', {
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

  const handleAiSearch = async () => {
    if (isAiLoading || !apiKey || !selectedService) return;
    if (!searchParams.sector) return alert('Lütfen sektör alanını doldurun.');

    setIsAiLoading(true);
    setSearchProgress(0);
    setSearchStatus('Yapay zeka motoru hazırlanıyor...');
    setAiResults([]);

    // Find our database IDs for sectors
    let mainSectorId = null;
    let subSectorId = null;
    let currentMainSectorName = searchParams.mainSector;
    let finalSectorName = searchParams.sector;

    const foundMain = (allSectors || []).find(m =>
      (m.sub_sectors || []).some(s => s.name?.toLowerCase() === searchParams.sector.toLowerCase()) ||
      (searchParams.mainSector && m.name?.toLowerCase() === searchParams.mainSector.toLowerCase())
    );

    if (foundMain) {
      mainSectorId = foundMain.id;
      currentMainSectorName = foundMain.name;
      const foundSub = foundMain.sub_sectors.find(s => s.name.toLowerCase() === searchParams.sector.toLowerCase());
      if (foundSub) {
        subSectorId = foundSub.id;
        finalSectorName = foundSub.name;
      }
    }

    // Progress Simulation
    const progressInterval = setInterval(() => {
      setSearchProgress(prev => {
        if (prev >= 95) return prev;
        const inc = prev < 30 ? 2 : prev < 70 ? 0.5 : 0.1;
        return prev + inc;
      });
    }, 200);

    const maxRetries = 2;
    let retryCount = 0;

    const runAi = async () => {
      try {
        const locationText = searchParams.city
          ? `${searchParams.city}${searchParams.district ? `/${searchParams.district}` : ''} bölgesinde`
          : "Tüm Türkiye genelinde";

        setSearchStatus(`${locationText} ${finalSectorName} firmaları taranıyor...`);
        const genAI = new GoogleGenerativeAI(apiKey)
        const model = genAI.getGenerativeModel({
          model: selectedService.id,
          systemInstruction: "Sen profesyonel bir pazar araştırmacısısın. KESİN KURAL: Sadece gerçekte var olan ve AKTİF bir web sitesine sahip şirketleri listele."
        })

        const sectorQuery = currentMainSectorName
          ? `${currentMainSectorName} ana sektörü altındaki ${finalSectorName}`
          : finalSectorName;

        const prompt = `${locationText} "${sectorQuery}" alanında faaliyet gösteren gerçek şirketleri bul. 
        Maksimum 20 şirket getir, ancak liste dolsun diye kriteri bozma; sadece çalışan sitesi olanları getir.
        
        Veri formatı (Sadece JSON listesi):
        [
          {
            "company_name": "Gerçek Şirket Adı",
            "website": "https://www.sirket.com",
            "email": "info@gerceksirket.com",
            "city": "Bulunduğu Şehir",
            "district": "Bulunduğu İlçe/Bölge",
            "phone": "0XXXXXXXXXX",
            "authorized_person": "Biliniyorsa İsim"
          }
        ]`

        const result = await model.generateContent(prompt)
        const text = result.response.text()

        // Robust JSON extraction to handle chatty AI
        let data = [];
        try {
          const jsonMatch = text.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            data = JSON.parse(jsonMatch[0]);
          } else {
            throw new Error("AI geçerli bir JSON listesi döndürmedi.");
          }
        } catch (jsonErr) {
          console.error("JSON Parse Error:", jsonErr, "Original Text:", text);
          throw new Error("Veri formatı çözümlenemedi. Lütfen tekrar deneyin.");
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

        setAiResults(liveData)
        setSelectedForDb(new Set())
        setSearchProgress(100);
        setSearchStatus('Tamamlandı!');

        if (liveData.length === 0) {
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
      await runAi();
    } catch (err) {
      alert('AI Hatası: ' + err.message);
    } finally {
      clearInterval(progressInterval);
      setTimeout(() => setIsAiLoading(false), 500);
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

          <button className="surprise-btn" onClick={handleAiSearch} disabled={isAiLoading || isAutoDiscovering}>
            {isAiLoading ? <RefreshCw className="spin" size={18} strokeWidth={2} /> : <Sparkles size={18} strokeWidth={2} />}
            <span>Şaşırt Beni</span>
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
                <div className="progress-bar" style={{ width: `${(autoDiscoverStatus.current / autoDiscoverStatus.total) * 100}%` }}></div>
                <span>{autoDiscoverStatus.current} / {autoDiscoverStatus.total} Sektör</span>
              </div>
              {autoDiscoverStatus.isSaving && (
                <div className="saving-indicator">
                  <Database size={14} className="spin" /> Veriler Kaydediliyor...
                </div>
              )}
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
              <select
                value={customerFilters.mainSectorId}
                onChange={(e) => setCustomerFilters(prev => ({ ...prev, mainSectorId: e.target.value, subSectorId: '' }))}
                className="filter-select"
              >
                <option value="">Tüm Ana Sektörler</option>
                {allSectors.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>

              {customerFilters.mainSectorId && (
                <select
                  value={customerFilters.subSectorId}
                  onChange={(e) => setCustomerFilters(prev => ({ ...prev, subSectorId: e.target.value }))}
                  className="filter-select"
                >
                  <option value="">Tüm Alt Sektörler</option>
                  {(allSectors.find(s => String(s.id) === String(customerFilters.mainSectorId))?.sub_sectors || []).map(ss => (
                    <option key={ss.id} value={ss.id}>{ss.name}</option>
                  ))}
                </select>
              )}

              <div className="search-box">
                <Search size={16} />
                <input
                  placeholder="Hızlı arama (İsim, Şehir, Mail...)"
                  value={customerFilters.search}
                  onChange={(e) => setCustomerFilters(prev => ({ ...prev, search: e.target.value }))}
                />
              </div>
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
