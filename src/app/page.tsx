'use client';

import React, { useState, ChangeEvent, useEffect } from 'react';
import { Upload, Send, FileText, CheckCircle, XCircle, X, RefreshCw, Play, Info, Power } from 'lucide-react';

    // Airtable 설정
    const AIRTABLE_API_KEY = 'pat6S8lzX8deRFTKC.0e92c4403cdc7878f8e61f815260852d4518a0b46fa3de2350e5e91f4f0f6af9';
    const AIRTABLE_BASE_ID = 'appa5Q0PYdL5VY3RK';
    
    // API 설정
    const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://medicontents-be-u45006.vm.elestio.app';

// 탭 타입 정의
type TabType = 'review' | 'manual' | 'auto';

// 랜덤 Post ID 생성 함수
const generatePostId = (): string => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = 'QA_';
    for (let i = 0; i < 12; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

// Airtable API 함수들
const createMedicontentPost = async (postData: any): Promise<any> => {
    const response = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Medicontent%20Posts`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(postData)
    });
    
    if (!response.ok) {
        throw new Error(`Airtable API 오류: ${response.status}`);
    }
    
    return response.json();
};

const createPostDataRequest = async (requestData: any): Promise<any> => {
    const response = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Post%20Data%20Requests`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData)
    });
    
    if (!response.ok) {
        throw new Error(`Airtable API 오류: ${response.status}`);
    }
    
    return response.json();
};

// 완료된 포스팅 목록 조회
const getCompletedPosts = async (): Promise<any[]> => {
    const response = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Medicontent%20Posts?filterByFormula={Status}="작업 완료"&sort[0][field]=Updated At&sort[0][direction]=desc`, {
        headers: {
            'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json'
        }
    });
    
    if (!response.ok) {
        throw new Error(`Airtable API 오류: ${response.status}`);
    }
    
    const data = await response.json();
    return data.records;
};

// 포스팅 업데이트 (QA 검토 정보 저장)
const updatePostQA = async (postId: string, qaData: any): Promise<any> => {
            // console.log('업데이트할 데이터:', { postId, qaData });
    
    const response = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Medicontent%20Posts`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            records: [{
                id: postId,
                fields: qaData
            }]
        })
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        console.error('Airtable API 응답:', response.status, errorText);
        throw new Error(`Airtable API 오류: ${response.status} - ${errorText}`);
    }
    
    return response.json();
};

// 이미지 업로드 함수 - 실제 Airtable 업로드
const uploadImageToAirtable = async (file: File, recordId: string, fieldName: string): Promise<string> => {
    try {
        // 파일을 base64로 인코딩
        const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = reader.result as string;
                // data:image/jpeg;base64, 부분을 제거하고 base64 부분만 추출
                const base64Data = result.split(',')[1];
                resolve(base64Data);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });

        // Airtable 이미지 업로드 API 호출
        const response = await fetch(`https://content.airtable.com/v0/${AIRTABLE_BASE_ID}/${recordId}/${fieldName}/uploadAttachment`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contentType: file.type,
                file: base64,
                filename: file.name
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('이미지 업로드 응답:', response.status, errorText);
            throw new Error(`이미지 업로드 실패: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        // console.log('이미지 업로드 성공:', result);
        return result.id;
    } catch (error) {
        console.error('이미지 업로드 오류:', error);
        throw error;
    }
};

// 폼 데이터 타입 정의
interface FormData {
    treatmentType: string;
    questions: string[];
    beforeImages: File[];
    processImages: File[];
    afterImages: File[];
}

// 자동 생성 폼 데이터 타입 정의
interface AutoFormData {
    treatmentType: string;
    count: number;
}

// QA 검토 데이터 타입 정의
interface QAData {
    reviewer: string;
    contentReview: string;
    contentScore: number;
    legalReview: string;
    legalScore: number;
    etcReview: string;
}

// 메인 컴포넌트
export default function Home() {
    const [activeTab, setActiveTab] = useState<TabType>('review');
    const [completedPosts, setCompletedPosts] = useState<any[]>([]);
    const [selectedPost, setSelectedPost] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const [currentPostId, setCurrentPostId] = useState<string>('');
    const [isProcessing, setIsProcessing] = useState(false);
    
    // QA 검토 관련 상태
    const [qaData, setQaData] = useState<QAData>({
        reviewer: '',
        contentReview: '',
        contentScore: 0,
        legalReview: '',
        legalScore: 0,
        etcReview: ''
    });
    const [isSavingQA, setIsSavingQA] = useState(false);
    const [savedFields, setSavedFields] = useState<Set<string>>(new Set());
    const [leftPanelWidth, setLeftPanelWidth] = useState(50); // 좌측 패널 너비 (%)
    const [isResizing, setIsResizing] = useState(false);
    const [reviewerOptions, setReviewerOptions] = useState<string[]>(['YB', 'Min', 'Hani', 'Hyuni', 'Naten']);
    const [showNewReviewerInput, setShowNewReviewerInput] = useState(false);
    const [newReviewerName, setNewReviewerName] = useState('');
    
    // 검색 및 필터 상태
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | 'completed' | 'incomplete'>('all');
    const [filterReviewer, setFilterReviewer] = useState<string>('');
    const [filterContentScore, setFilterContentScore] = useState<string>('');
    const [filterLegalScore, setFilterLegalScore] = useState<string>('');
    
    // 폼 데이터 상태
    const [formData, setFormData] = useState<FormData>({
        treatmentType: '임플란트',
        questions: Array(8).fill(''),
        beforeImages: [],
        processImages: [],
        afterImages: []
    });

    // 자동 생성 폼 데이터 상태
    const [autoFormData, setAutoFormData] = useState<AutoFormData>({
        treatmentType: '임플란트',
        count: 1
    });

    // 자동 생성 진행 상태
    const [autoProcessing, setAutoProcessing] = useState(false);
    const [autoProgress, setAutoProgress] = useState({
        total: 0,
        completed: 0,
        current: 0,
        startTime: 0,
        isCompleted: false
    });

    // 탭 변경 시 우측 패널 초기화
    const handleTabChange = (newTab: TabType) => {
        setActiveTab(newTab);
        
        // 우측 패널 상태 초기화 (selectedPost는 유지)
        setLogs([]);
        setCurrentPostId('');
        setIsProcessing(false);
        setAutoProcessing(false);
        setAutoProgress({
            total: 0,
            completed: 0,
            current: 0,
            startTime: 0,
            isCompleted: false
        });
    };

    // 완료된 포스팅 목록 로드
    useEffect(() => {
        if (activeTab === 'review') {
            loadCompletedPosts();
        }
    }, [activeTab]);

    // 페이지 언로드 시 모든 폴링 중단
    useEffect(() => {
        const handleBeforeUnload = () => {
            // 모든 setInterval 중단
            for (let i = 1; i < 10000; i++) {
                clearInterval(i);
            }
        };
        
        window.addEventListener('beforeunload', handleBeforeUnload);
        
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
        };
    }, []);

    // localStorage에서 검토자 목록 로드 (클라이언트 사이드에서만)
    useEffect(() => {
        try {
            const saved = localStorage.getItem('reviewerOptions');
            if (saved) {
                const parsedOptions = JSON.parse(saved);
                setReviewerOptions(parsedOptions);
            }
        } catch (error) {
            console.error('localStorage 로드 실패:', error);
        }
    }, []);

    // 리사이즈 관련 함수들
    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);
    };

    const handleMouseMove = (e: MouseEvent) => {
        if (!isResizing) return;
        
        const container = document.getElementById('main-container');
        if (!container) return;
        
        const containerRect = container.getBoundingClientRect();
        const newWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100;
        
        // 최소 20%, 최대 80%로 제한
        const clampedWidth = Math.max(20, Math.min(80, newWidth));
        setLeftPanelWidth(clampedWidth);
    };

    const handleMouseUp = () => {
        setIsResizing(false);
    };

    // 마우스 이벤트 리스너 등록
    useEffect(() => {
        if (isResizing) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            
            return () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            };
        }
    }, [isResizing]);

    // 자동 생성 웹훅 호출 함수
    const callAutoGenerationWebhook = async (treatmentType: string, count: number) => {
        try {
            const response = await fetch('https://medisales-u45006.vm.elestio.app/webhook/f9cb5f6a-a22b-4141-8e6a-69373d0301d1', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    treatmentType: treatmentType,
                    count: count,
                    timestamp: new Date().toISOString(),
                    source: 'medicontents_QA_auto'
                })
            });

            if (response.ok) {
                // 응답 텍스트를 먼저 확인
                const responseText = await response.text();
                // console.log('웹훅 응답 텍스트:', responseText);
                
                // JSON 응답 파싱 시도
                try {
                    const result = JSON.parse(responseText);
                    // console.log('웹훅 응답 파싱 성공:', result);
                    return result;
                } catch (jsonError) {
                    // console.log('웹훅 응답이 JSON이 아님, 텍스트 응답으로 처리');
                    
                    // 텍스트 응답을 JSON 형태로 변환
                    return {
                        success: true,
                        message: responseText,
                        isTextResponse: true
                    };
                }
            } else {
                const errorText = await response.text();
                console.error('웹훅 응답 오류:', response.status, errorText);
                throw new Error(`웹훅 호출 실패: ${response.status} - ${errorText}`);
            }
        } catch (error) {
            console.error('웹훅 호출 오류:', error);
            throw error;
        }
    };

    // Post ID 생성 시 처리 함수
    const handlePostIdCreated = async (postId: string, startTime: number) => {
        addLog(`🔧 Post ID ${postId}에 대한 추가 처리 시작...`);
        
        // 진행 상황 업데이트 - total은 변경하지 않고 current만 증가
        setAutoProgress(prev => ({ 
            ...prev, 
            current: prev.current + 1
        }));
        
        // Post ID를 Airtable에서 확인
        try {
            const response = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Medicontent%20Posts?filterByFormula={Post%20Id}='${postId}'`, {
                headers: {
                    'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data.records && data.records.length > 0) {
                    addLog(`✅ Post ID ${postId}가 Medicontent Posts 테이블에 생성되었습니다.`);
                } else {
                    addLog(`⚠️ Post ID ${postId}가 아직 Medicontent Posts 테이블에 없습니다.`);
                }
            }
        } catch (error) {
            addLog(`❌ Post ID ${postId} 확인 중 오류: ${error}`);
        }
        
        // Post Data Requests 테이블도 확인
        try {
            const response = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Post%20Data%20Requests?filterByFormula={Post%20ID}='${postId}'`, {
                headers: {
                    'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data.records && data.records.length > 0) {
                    const status = data.records[0].fields.Status || '대기';
                    addLog(`📊 Post ID ${postId}의 Post Data Requests 상태: ${status}`);
                } else {
                    addLog(`⚠️ Post ID ${postId}가 아직 Post Data Requests 테이블에 없습니다.`);
                }
            }
        } catch (error) {
            addLog(`❌ Post ID ${postId} Post Data Requests 확인 중 오류: ${error}`);
        }
    };

    // 자동 생성 처리 함수
    const handleAutoGeneration = async () => {
        const startTime = Date.now();
        let pollInterval: NodeJS.Timeout | undefined;
        
        try {
            setAutoProcessing(true);
            setAutoProgress({
                total: autoFormData.count,
                completed: 0,
                current: 0,
                startTime: startTime,
                isCompleted: false
            });
            
            addLog('자동 생성 웹훅 호출 시작...');
            
            const webhookResult = await callAutoGenerationWebhook(
                autoFormData.treatmentType, 
                autoFormData.count
            );
            
            addLog(`웹훅 호출 완료: ${autoFormData.count}개 포스팅 생성 요청`);
            
                            // 웹훅 응답 처리
                if (webhookResult.success) {
                    addLog(`📡 웹훅 응답: ${webhookResult.message || '성공'}`);
                    
                    // 웹훅 'success' 응답 감지
                    if (webhookResult.message && webhookResult.message.toLowerCase().includes('success')) {
                        addLog('✅ 웹훅 success 응답 감지 - 전체 완료로 판단');
                        
                        // 완료 후에도 진행 상황 표시 유지
                        setAutoProgress(prev => ({
                            ...prev,
                            isCompleted: true
                        }));
                        
                        // autoProcessing 상태도 완료로 변경
                        setAutoProcessing(false);
                        return;
                    }
                    
                    // 텍스트 응답인 경우 특별 처리
                    if (webhookResult.isTextResponse) {
                    addLog(`📝 텍스트 응답 처리 중...`);
                    
                    // 자동 생성 시작 메시지 처리
                    if (webhookResult.message.includes('가상 포스팅 자동 생성 시작')) {
                        addLog(`🚀 자동 생성 프로세스가 시작되었습니다.`);
                        addLog(`⏳ n8n에서 작업을 진행 중입니다. 실시간 로그를 모니터링합니다...`);
                        
                        // 실시간 로그 폴링 시작
                        const startLogPolling = () => {
                            const processedLogs = new Set(); // 처리된 로그 추적
                            
                            const pollInterval = setInterval(async () => {
                                try {
                                    // 최근 Post Data Requests에서 생성된 Post ID 찾기
                                    const response = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Post%20Data%20Requests?sort[0][field]=Submitted At&sort[0][direction]=desc&maxRecords=5`, {
                                        headers: {
                                            'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
                                            'Content-Type': 'application/json'
                                        }
                                    });
                                    
                                    if (response.ok) {
                                        const data = await response.json();
                                        const recentPosts = data.records || [];
                                        
                                        // 모니터링 시작 시점 이후에 생성된 포스트 찾기
                                        const monitoringStartTime = new Date(startTime);
                                        const newPosts = recentPosts.filter((post: any) => {
                                            const submittedTime = new Date(post.fields['Submitted At'] || post.createdTime);
                                            return submittedTime > monitoringStartTime;
                                        });
                                        
                                        // 각 Post ID에 대해 실시간 로그 폴링 (Agent 작업 진행 상황)
                                        for (const post of newPosts) {
                                            const postId = post.fields['Post ID'];
                                            if (postId) {
                                                addLog(`🔍 Post ID ${postId} 로그 확인 중...`);
                                                
                                                try {
                                                    const logResponse = await fetch(`${API_BASE_URL}/api/get-logs/${postId}`);
                                                    if (logResponse.ok) {
                                                        const logData = await logResponse.json();
                                                        if (logData.logs && logData.logs.length > 0) {
                                                            addLog(`📝 Post ID ${postId}에서 ${logData.logs.length}개의 로그 발견`);
                                                            
                                                            // 새로운 로그만 처리 (중복 방지)
                                                            const newLogs = logData.logs.filter((log: any) => {
                                                                const logKey = `${postId}_${log.timestamp}_${log.message}`;
                                                                if (processedLogs.has(logKey)) {
                                                                    return false; // 이미 처리된 로그
                                                                }
                                                                processedLogs.add(logKey);
                                                                return true;
                                                            });
                                                            
                                                            if (newLogs.length > 0) {
                                                                addLog(`🆕 Post ID ${postId}에서 ${newLogs.length}개의 새 로그 발견`);
                                                            }
                                                            
                                                            // 새로운 로그들을 추가 (Agent 작업 진행 상황만)
                                                            newLogs.forEach((log: any) => {
                                                                if (log.level === 'INFO' || log.level === 'ERROR' || log.level === 'WARNING') {
                                                                    const message = log.message.replace(/^.*?:\s*/, ''); // 로거 이름 제거
                                                                    
                                                                    if (message.includes('Step') || message.includes('Agent') || message.includes('실행') || 
                                                                        message.includes('완료') || message.includes('오류') || message.includes('실패')) {
                                                                        addLog(`[${postId}] [${log.level}] ${message}`);
                                                                    }
                                                                }
                                                            });
                                                        } else {
                                                            addLog(`📭 Post ID ${postId}에서 로그가 없습니다.`);
                                                        }
                                                    } else {
                                                        addLog(`❌ Post ID ${postId} 로그 조회 실패: ${logResponse.status}`);
                                                    }
                                                } catch (error) {
                                                    addLog(`❌ Post ID ${postId} 로그 폴링 오류: ${error}`);
                                                }
                                            }
                                        }
                                    }
                                } catch (error) {
                                    console.error('로그 폴링 오류:', error);
                                }
                            }, 3000); // 3초마다 폴링
                            
                            return pollInterval;
                        };
                        
                        pollInterval = startLogPolling();
                        
                        // Airtable 상태 모니터링과 함께 진행
                        await monitorAutoGenerationProgress(startTime);
                        
                        // 폴링 중지
                        if (pollInterval) {
                            clearInterval(pollInterval);
                        }
                        return;
                    }
                    
                    // Post ID 생성 응답 처리
                    if (webhookResult.message.includes('Post ID = ')) {
                        const postIdMatch = webhookResult.message.match(/Post ID = (QA_[A-Za-z0-9]+)/);
                        if (postIdMatch) {
                            const postId = postIdMatch[1];
                            addLog(`🆔 Post ID 생성됨: ${postId}`);
                            
                            // Post ID를 활용한 추가 처리
                            await handlePostIdCreated(postId, startTime);
                        }
                    }
                    
                    // 기타 텍스트 응답 처리
                    if (webhookResult.message.includes('완료') || webhookResult.message.includes('성공')) {
                        addLog(`✅ 작업 완료: ${webhookResult.message}`);
                        const endTime = Date.now();
                        const totalTime = Math.round((endTime - startTime) / 1000);
                        addLog(`🎉 자동 생성 프로세스 완료 (소요시간: ${totalTime}초)`);
                        
                        // 완료 후에도 진행 상황 표시 유지
                        setAutoProgress(prev => ({
                            ...prev,
                            isCompleted: true
                        }));
                        return;
                    }
                    
                    // 기타 메시지는 그대로 로그에 출력하고 모니터링 계속
                    addLog(`⏳ 진행 중: ${webhookResult.message}`);
                    await monitorAutoGenerationProgress(startTime);
                    return;
                }
                
                // JSON 응답 처리 (기존 로직)
                // Post ID 생성 응답 처리
                if (webhookResult.message && webhookResult.message.includes('Post ID = ')) {
                    const postIdMatch = webhookResult.message.match(/Post ID = (QA_[A-Za-z0-9]+)/);
                    if (postIdMatch) {
                        const postId = postIdMatch[1];
                        addLog(`🆔 Post ID 생성됨: ${postId}`);
                        
                        // Post ID를 활용한 추가 처리
                        await handlePostIdCreated(postId, startTime);
                    }
                }
                
                // 응답 단계 확인
                const step = webhookResult.step || 'unknown';
                if (step !== 'unknown') {
                    addLog(`📊 현재 단계: ${step}`);
                }
                
                // Post ID 목록이 있는 경우
                if (webhookResult.postIds && Array.isArray(webhookResult.postIds) && webhookResult.postIds.length > 0) {
                    addLog(`📋 생성된 Post ID 목록: ${webhookResult.postIds.join(', ')}`);
                    
                    // 단계에 따른 처리
                    if (step === 'post_creation_complete') {
                        addLog('✅ Post ID 생성 완료. Agent 작업 시작을 기다리는 중...');
                        await monitorAutoGenerationProgress(startTime);
                    } else if (step === 'agent_started') {
                        addLog('🤖 Agent 작업이 시작되었습니다. 진행 상황을 모니터링합니다...');
                        await monitorAutoGenerationProgress(startTime);
                    } else if (step === 'all_complete') {
                        addLog('🎉 모든 작업이 완료되었습니다!');
                        const endTime = Date.now();
                        const totalTime = Math.round((endTime - startTime) / 1000);
                        addLog(`✅ 자동 생성 프로세스 완료 (소요시간: ${totalTime}초)`);
                        
                        setTimeout(() => {
                            setAutoProcessing(false);
                        }, 3000);
                    } else {
                        addLog('⏳ n8n에서 작업을 진행 중입니다. 상태를 모니터링합니다...');
                        await monitorAutoGenerationProgress(startTime);
                    }
                } else {
                    addLog('⏳ n8n에서 Post ID 생성 및 Agent 작업을 진행 중입니다. 상태를 모니터링합니다...');
                    await monitorAutoGenerationProgress(startTime);
                }
            } else {
                addLog(`❌ 웹훅 호출 실패: ${webhookResult.message || '알 수 없는 오류'}`);
                if (webhookResult.error) {
                    addLog(`🔍 오류 상세: ${webhookResult.error}`);
                }
                setAutoProcessing(false);
            }
            
        } catch (error) {
            addLog(`자동 생성 오류: ${error}`);
            setAutoProcessing(false);
        } finally {
            // 폴링 중지
            if (pollInterval) {
                clearInterval(pollInterval);
            }
        }
    };

    // 자동 생성 진행 상황 모니터링
    const monitorAutoGenerationProgress = async (startTime: number) => {
        const maxWaitTime = 300000; // 5분
        const checkInterval = 5000; // 5초마다 체크
        let elapsedTime = 0;
        
        // 모니터링 시작 시점 기록
        const monitoringStartTime = new Date(startTime);
        addLog(`📊 모니터링 시작 시점: ${monitoringStartTime.toLocaleTimeString()}`);
        
        // 추적할 Post ID 목록 (빈 배열로 시작)
        let trackedPostIds: string[] = [];
        let completedPostIds: string[] = [];
        let processedLogs: Set<string> = new Set(); // 처리된 로그 추적
        let lastStatus: string | null = null; // 마지막 상태 추적
        
        while (elapsedTime < maxWaitTime) {
            await new Promise(resolve => setTimeout(resolve, checkInterval));
            elapsedTime += checkInterval;
            
            try {
                // 최근에 생성된 Post Data Requests 확인
                const response = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Post%20Data%20Requests?sort[0][field]=Submitted At&sort[0][direction]=desc&maxRecords=20`, {
                    headers: {
                        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
                        'Content-Type': 'application/json'
                    }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    const allPosts = data.records || [];
                    
                    // 모니터링 시작 시점 이후에 생성된 포스트만 필터링
                    const recentPosts = allPosts.filter((post: any) => {
                        const submittedTime = new Date(post.fields['Submitted At'] || post.createdTime);
                        return submittedTime > monitoringStartTime;
                    });
                    
                    // 새로운 Post ID 발견 시 추적 목록에 추가
                    recentPosts.forEach((post: any) => {
                        const postId = post.fields['Post ID'];
                        if (postId && !trackedPostIds.includes(postId)) {
                            trackedPostIds.push(postId);
                            addLog(`🆔 새로운 Post ID 발견: ${postId}`);
                            
                            // 새로운 Post ID 발견 시 current 업데이트 (total을 초과하지 않도록)
                            setAutoProgress(prev => ({
                                ...prev,
                                current: Math.min(trackedPostIds.length, prev.total)
                            }));
                        }
                    });
                    
                    // 각 추적 중인 Post ID의 상태 확인
                    for (const postId of trackedPostIds) {
                        if (!completedPostIds.includes(postId)) {
                            try {
                                // 1단계: Post Data Requests 테이블에서 Agent 작업 완료 확인
                                const postDataResponse = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Post%20Data%20Requests?filterByFormula={Post%20ID}='${postId}'`, {
                                    headers: {
                                        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
                                        'Content-Type': 'application/json'
                                    }
                                });
                                
                                if (postDataResponse.ok) {
                                    const postData = await postDataResponse.json();
                                    const postDataRecord = postData.records?.[0];
                                    
                                    if (postDataRecord) {
                                        const postDataStatus = postDataRecord.fields.Status || '대기';
                                        
                                        if (postDataStatus === '완료') {
                                            // 2단계: Medicontent Posts 테이블에서 전체 작업 완료 확인
                                            const medicontentResponse = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Medicontent%20Posts?filterByFormula={Post%20Id}='${postId}'`, {
                                                headers: {
                                                    'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
                                                    'Content-Type': 'application/json'
                                                }
                                            });
                                            
                                            if (medicontentResponse.ok) {
                                                const medicontentData = await medicontentResponse.json();
                                                const medicontentRecord = medicontentData.records?.[0];
                                                
                                                if (medicontentRecord) {
                                                    const medicontentStatus = medicontentRecord.fields.Status || '대기';
                                                    
                                                    if (medicontentStatus === '작업 완료') {
                                                        completedPostIds.push(postId);
                                                        addLog(`✅ Post ID ${postId} 모든 작업 완료 확인됨 (Post Data: 완료, Medicontent: 작업 완료)`);
                                                        
                                                        // autoProgress 상태 업데이트
                                                        setAutoProgress(prev => ({
                                                            ...prev,
                                                            completed: prev.completed + 1
                                                        }));
                                                    } else if (medicontentStatus === '리걸케어 작업 중') {
                                                        addLog(`📊 Post ID ${postId} Agent 작업 완료, n8n 후속 작업 진행 중...`);
                                                    } else {
                                                        addLog(`📊 Post ID ${postId} Post Data 완료, Medicontent Status: ${medicontentStatus}`);
                                                    }
                                                }
                                            }
                                        } else if (postDataStatus === '처리 중') {
                                            addLog(`📊 Post ID ${postId} Agent 작업 진행 중...`);
                                            
                                            // 진행 중인 작업으로 current 업데이트 (total을 초과하지 않도록)
                                            setAutoProgress(prev => ({
                                                ...prev,
                                                current: Math.min(trackedPostIds.length, prev.total)
                                            }));
                                        } else {
                                            addLog(`📊 Post ID ${postId} Post Data Status: ${postDataStatus}`);
                                        }
                                    }
                                }
                            } catch (error) {
                                addLog(`Post ID ${postId} 상태 확인 오류: ${error}`);
                            }
                        }
                    }
                    
                    // 완료 조건 확인 - 요청한 개수만큼 모두 "후속 작업 완료"되었는지 확인
                    if (completedPostIds.length >= autoFormData.count) {
                        const endTime = Date.now();
                        const totalTime = Math.round((endTime - startTime) / 1000);
                        addLog(`🎉 모든 작업 완료! 요청한 ${autoFormData.count}개 중 ${completedPostIds.length}개 포스팅의 후속 작업이 완료되었습니다.`);
                        addLog(`✅ 완료된 Post ID 목록: ${completedPostIds.join(', ')}`);
                        addLog(`✅ 자동 생성 프로세스가 성공적으로 완료되었습니다. (소요시간: ${totalTime}초)`);
                        
                        // 완료 후에도 진행 상황 표시 유지
                        setAutoProgress(prev => ({
                            ...prev,
                            isCompleted: true
                        }));
                        
                        // autoProcessing 상태도 완료로 변경
                        setAutoProcessing(false);
                        return;
                    }
                    
                    // 진행 상황 요약 (변경사항이 있을 때만 출력)
                    if (trackedPostIds.length > 0) {
                        const currentStatus = `요청 ${autoFormData.count}개 / 추적 중 ${trackedPostIds.length}개 / 후속 작업 완료 ${completedPostIds.length}개`;
                        
                        // 상태가 변경되었을 때만 로그 출력
                        if (!lastStatus || lastStatus !== currentStatus) {
                            addLog(`📈 진행 상황: ${currentStatus}`);
                            if (completedPostIds.length > 0) {
                                addLog(`✅ 완료된 Post ID: ${completedPostIds.join(', ')}`);
                            }
                            lastStatus = currentStatus;
                        }
                    }
                }
                
                // 경과 시간 로그는 30초마다만 출력
                const elapsedSeconds = Math.round(elapsedTime / 1000);
                if (elapsedSeconds % 30 === 0 && elapsedSeconds > 0) {
                    addLog(`⏳ Agent 작업 진행 중... (${elapsedSeconds}초 경과)`);
                }
                
            } catch (error) {
                addLog(`모니터링 오류: ${error}`);
            }
        }
        
        addLog(`⏰ 최대 대기 시간 초과. 모니터링을 종료합니다.`);
        setAutoProcessing(false);
    };

    // 단일 포스트 진행 상황 모니터링
    const monitorSinglePostProgress = async (postId: string, startTime: number) => {
        const maxWaitTime = 120000; // 2분
        const checkInterval = 3000; // 3초마다 체크
        let elapsedTime = 0;
        
        while (elapsedTime < maxWaitTime) {
            await new Promise(resolve => setTimeout(resolve, checkInterval));
            elapsedTime += checkInterval;
            
            try {
                const response = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Post%20Data%20Requests?filterByFormula={Post%20ID}='${postId}'`, {
                    headers: {
                        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
                        'Content-Type': 'application/json'
                    }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    const records = data.records || [];
                    
                    if (records.length > 0) {
                        const status = records[0].fields.Status;
                        
                        if (status === '완료') {
                            addLog(`✅ Post ID ${postId} Agent 작업 완료`);
                            return;
                        } else if (status === '오류') {
                            addLog(`❌ Post ID ${postId} Agent 작업 실패`);
                            return;
                        }
                    }
                }
                
            } catch (error) {
                addLog(`Post ID ${postId} 모니터링 오류: ${error}`);
            }
        }
        
        addLog(`⏰ Post ID ${postId} 모니터링 시간 초과`);
    };

    // 래덤 데이터 불러오기
    // 재시작 함수
    const handleRestart = async () => {
        if (!confirm('백엔드 서버를 재시작하시겠습니까? 이 작업은 약 30초 정도 소요됩니다.')) {
            return;
        }
        
        try {
            addLog('🔄 백엔드 재시작 요청 중...');
            
            const response = await fetch(`${API_BASE_URL}/api/restart`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            const result = await response.json();
            
            if (result.status === 'success') {
                addLog('✅ 백엔드 재시작 성공!');
                addLog(`🕐 재시작 시간: ${new Date(result.restart_time).toLocaleString()}`);
                
                // 30초 후 서버 상태 확인
                setTimeout(async () => {
                    try {
                        const healthCheck = await fetch(`${API_BASE_URL}/api/health`);
                        if (healthCheck.ok) {
                            addLog('✅ 서버 상태 확인 완료 - 정상 작동 중');
                        } else {
                            addLog('⚠️ 서버 상태 확인 실패');
                        }
                    } catch (error) {
                        addLog('⚠️ 서버 상태 확인 중 오류 발생');
                    }
                }, 30000);
                
            } else {
                addLog(`❌ 백엔드 재시작 실패: ${result.message}`);
            }
            
        } catch (error) {
            addLog(`❌ 재시작 요청 중 오류: ${error}`);
        }
    };

    const loadRandomData = async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/random-post-data`);
            if (response.ok) {
                const data = await response.json();
                if (data.status === 'success' && data.data) {
                    const randomData = data.data;
                    
                    // 샘플 이미지들을 File 객체로 생성
                    const createSampleImageFile = (filename: string): File => {
                        // 간단한 샘플 이미지 데이터 (1x1 픽셀 JPEG)
                        const sampleImageData = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';
                        const byteCharacters = atob(sampleImageData.split(',')[1]);
                        const byteNumbers = new Array(byteCharacters.length);
                        for (let i = 0; i < byteCharacters.length; i++) {
                            byteNumbers[i] = byteCharacters.charCodeAt(i);
                        }
                        const byteArray = new Uint8Array(byteNumbers);
                        const blob = new Blob([byteArray], { type: 'image/jpeg' });
                        return new File([blob], filename, { type: 'image/jpeg' });
                    };
                    
                    // 샘플 이미지 파일들 생성
                    const beforeImage = createSampleImageFile('sample_before.jpg');
                    const processImage = createSampleImageFile('sample_process.jpg');
                    const afterImage = createSampleImageFile('sample_after.jpg');
                    
                    // 폼 데이터 업데이트
                    setFormData(prev => ({
                        ...prev,
                        questions: [
                            randomData.concept_message || '',
                            randomData.patient_condition || '',
                            randomData.treatment_process_message || '',
                            randomData.treatment_result_message || '',
                            randomData.additional_message || '',
                            '초진 시 촬영한 파노라마 사진. 치아 주변으로 잇몸 손상 확인됨',
                            '디지털 가이드 사진',
                            '임플란트 완료 후 정상적으로 재건된 모습'
                        ],
                        beforeImages: [beforeImage],
                        processImages: [processImage],
                        afterImages: [afterImage]
                    }));
                    
                    // 성공 메시지 표시
                    alert('기존 데이터와 샘플 이미지를 성공적으로 불러왔습니다!');
                } else {
                    alert('데이터를 불러오는데 실패했습니다.');
                }
            } else {
                alert('서버 오류가 발생했습니다.');
            }
        } catch (error) {
            console.error('랜덤 데이터 불러오기 오류:', error);
            alert('데이터를 불러오는 중 오류가 발생했습니다.');
        }
    };

    // 신규 검토자 추가
    const addNewReviewer = () => {
        if (newReviewerName.trim() && !reviewerOptions.includes(newReviewerName.trim())) {
            const newOptions = [...reviewerOptions, newReviewerName.trim()].sort();
            setReviewerOptions(newOptions);
            
            // localStorage에 저장
            localStorage.setItem('reviewerOptions', JSON.stringify(newOptions));
            
            setQaData(prev => ({ ...prev, reviewer: newReviewerName.trim() }));
            setNewReviewerName('');
            setShowNewReviewerInput(false);
        }
    };

    // 포스팅 선택 시 QA 데이터 로드
    useEffect(() => {
        if (selectedPost) {
            loadQAData(selectedPost);
        }
    }, [selectedPost]);

    // QA 데이터 로드
    const loadQAData = (post: any) => {
        const fields = post.fields;
        setQaData({
            reviewer: fields.QA_by || '',
            contentReview: fields.QA_content || '',
            contentScore: fields.QA_content_score || 0,
            legalReview: fields.QA_legal || '',
            legalScore: fields.QA_legal_score || 0,
            etcReview: fields.QA_etc || ''
        });
    };

    // QA 데이터 저장
    const saveQAData = async (type: 'content' | 'legal' | 'etc' | 'reviewer') => {
        if (!selectedPost) return;
        
        try {
            setIsSavingQA(true);
            
            const updateFields: any = {};
            
            switch (type) {
                case 'reviewer':
                    updateFields.QA_by = qaData.reviewer;
                    break;
                case 'content':
                    updateFields.QA_content = qaData.contentReview;
                    updateFields.QA_content_score = qaData.contentScore;
                    break;
                case 'legal':
                    updateFields.QA_legal = qaData.legalReview;
                    updateFields.QA_legal_score = qaData.legalScore;
                    break;
                case 'etc':
                    updateFields.QA_etc = qaData.etcReview;
                    break;
            }
            
            // QA_yn 컬럼 업데이트 (어느 하나라도 내용이 있으면 true)
            const hasContent = qaData.reviewer || qaData.contentReview || qaData.legalReview || qaData.etcReview;
            updateFields.QA_yn = Boolean(hasContent);
            
            await updatePostQA(selectedPost.id, updateFields);
            
            // 저장된 필드 표시
            setSavedFields(prev => {
                const newSet = new Set(prev);
                newSet.add(type);
                return newSet;
            });
            
            // 3초 후 저장 완료 표시 제거
            setTimeout(() => {
                setSavedFields(prev => {
                    const newSet = new Set(prev);
                    newSet.delete(type);
                    return newSet;
                });
            }, 3000);
            
        } catch (error) {
            console.error('QA 데이터 저장 실패:', error);
            alert('저장에 실패했습니다.');
        } finally {
            setIsSavingQA(false);
        }
    };

    // 포스팅 선택 핸들러
    const handlePostSelect = (post: any) => {
        setSelectedPost(post);
        setSavedFields(new Set()); // 저장 상태 초기화
        
        // 선택된 포스팅을 상단으로 스크롤
        const postElement = document.getElementById(`post-${post.id}`);
        if (postElement) {
            postElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };

    // 점수에 따른 색상 반환
    const getScoreColor = (contentScore: number, legalScore: number, hasQA: boolean) => {
        // QA가 완료되지 않은 경우 기본 색상
        if (!hasQA) return 'bg-white border-gray-200';
        
        // QA가 완료된 경우 점수에 따른 색상
        if (contentScore <= 1 || legalScore <= 1) return 'bg-red-50 border-red-200';
        if (contentScore <= 3 || legalScore <= 3) return 'bg-yellow-50 border-yellow-200';
        if (contentScore >= 4 && legalScore >= 4) return 'bg-green-50 border-green-200';
        return 'bg-white border-gray-200';
    };

    // 필터링된 포스팅 목록
    const filteredPosts = completedPosts.filter(post => {
        const fields = post.fields;
        const postId = fields['Post Id'] || '';
        const title = fields.Title || '';
        const hasQA = fields.QA_yn || false;
        const reviewer = fields.QA_by || '';
        const contentScore = fields.QA_content_score || 0;
        const legalScore = fields.QA_legal_score || 0;
        
        // 검색어 필터
        const matchesSearch = searchTerm === '' || 
            postId.toLowerCase().includes(searchTerm.toLowerCase()) ||
            title.toLowerCase().includes(searchTerm.toLowerCase());
        
        // 상태 필터
        let matchesStatus = true;
        if (filterStatus === 'completed') {
            matchesStatus = hasQA;
        } else if (filterStatus === 'incomplete') {
            matchesStatus = !hasQA;
        }
        
        // 검토자 필터
        const matchesReviewer = filterReviewer === '' || reviewer === filterReviewer;
        
        // 컨텐츠 점수 필터
        let matchesContentScore = true;
        if (filterContentScore) {
            const [min, max] = filterContentScore.split('-').map(Number);
            if (max) {
                matchesContentScore = contentScore >= min && contentScore <= max;
            } else {
                matchesContentScore = contentScore >= min;
            }
        }
        
        // 의료법 점수 필터
        let matchesLegalScore = true;
        if (filterLegalScore) {
            const [min, max] = filterLegalScore.split('-').map(Number);
            if (max) {
                matchesLegalScore = legalScore >= min && legalScore <= max;
            } else {
                matchesLegalScore = legalScore >= min;
            }
        }
        
        return matchesSearch && matchesStatus && matchesReviewer && matchesContentScore && matchesLegalScore;
    });

    const loadCompletedPosts = async () => {
        try {
            setIsLoading(true);
            const posts = await getCompletedPosts();
            setCompletedPosts(posts);
        } catch (error) {
            console.error('포스팅 목록 로드 실패:', error);
        } finally {
            setIsLoading(false);
        }
    };

    // 로그 추가 함수 (최신 메시지가 위에 표시되도록)
    const addLog = (message: string) => {
        setLogs(prev => [`${new Date().toLocaleTimeString()}: ${message}`, ...prev]);
    };

    // 이미지 업로드 핸들러
    const handleImageUpload = (files: FileList | null, type: 'before' | 'process' | 'after') => {
        if (!files) return;
        
        const fileArray = Array.from(files);
        setFormData(prev => ({
            ...prev,
            [`${type}Images`]: [...prev[`${type}Images` as keyof FormData] as File[], ...fileArray]
        }));
    };

    // 이미지 제거 핸들러
    const removeImage = (index: number, type: 'before' | 'process' | 'after') => {
        setFormData(prev => ({
            ...prev,
            [`${type}Images`]: (prev[`${type}Images` as keyof FormData] as File[]).filter((_, i) => i !== index)
        }));
    };

    // 폼 제출 핸들러
    const handleSubmit = async () => {
        let pollInterval: NodeJS.Timeout | undefined;
        let statusPollInterval: NodeJS.Timeout | undefined;
        
        try {
            setIsProcessing(true);
            setLogs([]);
            
            const postId = generatePostId();
            setCurrentPostId(postId);

            // 1. Medicontent Posts 테이블에 데이터 생성
            const medicontentPostData = {
                fields: {
                    'Post Id': postId,
                    'Title': `(작성 전) ${postId}`,
                    'Type': '전환 포스팅',
                    'Status': '리걸케어 작업 중',
                    'Treatment Type': formData.treatmentType
                }
            };
            
            const medicontentResult = await createMedicontentPost(medicontentPostData);

            // 2. Post Data Requests 테이블에 데이터 생성
            const postDataRequestData = {
                fields: {
                    'Post ID': postId,
                    'Concept Message': formData.questions[0] || '',
                    'Patient Condition': formData.questions[1] || '',
                    'Treatment Process Message': formData.questions[2] || '',
                    'Treatment Result Message': formData.questions[3] || '',
                    'Additional Message': formData.questions[4] || '',
                    'Before Images': [],
                    'Process Images': [],
                    'After Images': [],
                    'Before Images Texts': formData.questions[5] || '',
                    'Process Images Texts': formData.questions[6] || '',
                    'After Images Texts': formData.questions[7] || '',
                    'Status': '대기'
                }
            };
            
            const postDataRequestResult = await createPostDataRequest(postDataRequestData);
            const recordId = postDataRequestResult.id;

            // 3. 이미지 업로드
            const allImages = [
                ...formData.beforeImages.map(file => ({ file, field: 'Before Images' })),
                ...formData.processImages.map(file => ({ file, field: 'Process Images' })),
                ...formData.afterImages.map(file => ({ file, field: 'After Images' }))
            ];

            for (const { file, field } of allImages) {
                try {
                    await uploadImageToAirtable(file, recordId, field);
                } catch (error) {
                    // 이미지 업로드 실패 시 무시
                }
            }

            // 4. Agent 실행
            
            // 실시간 로그 폴링 시작 (완전 비활성화)
            const startLogPolling = () => {
                // 로그 폴링을 완전히 비활성화
                const pollInterval = setInterval(async () => {
                    // 아무것도 하지 않음
                }, 2000);
                
                return pollInterval;
            };
            
            const pollInterval = startLogPolling();
            
            const agentResponse = await fetch(`${API_BASE_URL}/api/process-post`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ post_id: postId })
            });

            if (agentResponse.ok) {
                // 폴링 중지
                clearInterval(pollInterval);
                
                const agentData = await agentResponse.json();
                
                // Agent 응답에서 완료 상태 확인
                if (agentData.status === 'success') {
                    // 백엔드 로그 폴링 시작 (INFO:main: 로그만 출력)
                    let attempts = 0;
                    const maxAttempts = 60; // 2분 대기 (60회 × 2초)
                    
                    const logPollInterval = setInterval(async () => {
                        attempts++;
                        
                        try {
                            // 백엔드 로그 확인
                            const logResponse = await fetch(`${API_BASE_URL}/api/get-logs/${postId}`);
                            if (logResponse.ok) {
                                const logData = await logResponse.json();
                                if (logData.logs && logData.logs.length > 0) {
                                    // INFO:main: 로그만 출력
                                    logData.logs.forEach((log: any) => {
                                        if (log.message && log.message.startsWith('INFO:main:')) {
                                            addLog(log.message);
                                        }
                                    });
                                }
                            }
                            
                            // 타임아웃 체크
                            if (attempts >= maxAttempts) {
                                clearInterval(logPollInterval);
                            }
                            
                        } catch (error) {
                            attempts++;
                            
                            if (attempts >= maxAttempts) {
                                clearInterval(logPollInterval);
                            }
                        }
                    }, 2000); // 2초마다 확인
                }
            } else {
                // 폴링 중지
                clearInterval(pollInterval);
                
                const errorText = await agentResponse.text();
                // 오류 로그는 출력하지 않음
            }

        } catch (error) {
            // 오류 로그는 출력하지 않음
        } finally {
            // 폴링 중지 (혹시 아직 실행 중이라면)
            if (typeof pollInterval !== 'undefined') {
                clearInterval(pollInterval);
            }
            setIsProcessing(false);
        }
    };

    // 탭 렌더링 함수
    const renderTabContent = () => {
        switch (activeTab) {
            case 'review':
                return (
                    <div className="flex-1 overflow-auto">
                        <div className="p-4">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-semibold">완료된 포스팅 목록</h3>
                                <div className="flex items-center space-x-2">
                                    <button
                                        onClick={loadCompletedPosts}
                                        className="p-2 rounded-md hover:bg-gray-100"
                                        disabled={isLoading}
                                    >
                                        <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
                                    </button>
                                    <button
                                        onClick={handleRestart}
                                        className="px-3 py-2 rounded-md text-sm font-medium bg-red-100 text-red-700 hover:bg-red-200 flex items-center space-x-1"
                                        title="백엔드 서버 재시작"
                                    >
                                        <Power size={14} />
                                        <span>재시작</span>
                                    </button>
                                </div>
                            </div>
                            
                            {/* 검색 및 필터 영역 */}
                            <div className="mb-6 space-y-4">
                                {/* 검색 */}
                                <div>
                                    <input
                                        type="text"
                                        placeholder="Post ID 또는 제목으로 검색..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        className="w-full p-2 border border-gray-300 rounded-md"
                                    />
                                </div>
                                
                                {/* 필터 */}
                                <div className="grid grid-cols-2 gap-4 mb-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            QA 상태
                                        </label>
                                        <select
                                            value={filterStatus}
                                            onChange={(e) => setFilterStatus(e.target.value as 'all' | 'completed' | 'incomplete')}
                                            className="w-full p-2 border border-gray-300 rounded-md"
                                        >
                                            <option value="all">전체</option>
                                            <option value="completed">QA 완료</option>
                                            <option value="incomplete">QA 미완료</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            검토자
                                        </label>
                                        <select
                                            value={filterReviewer}
                                            onChange={(e) => setFilterReviewer(e.target.value)}
                                            className="w-full p-2 border border-gray-300 rounded-md"
                                        >
                                            <option value="">전체</option>
                                            {reviewerOptions.map((reviewer) => (
                                                <option key={reviewer} value={reviewer}>
                                                    {reviewer}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                
                                {/* 점수 필터 */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            컨텐츠 점수
                                        </label>
                                        <select
                                            value={filterContentScore}
                                            onChange={(e) => setFilterContentScore(e.target.value)}
                                            className="w-full p-2 border border-gray-300 rounded-md"
                                        >
                                            <option value="">전체</option>
                                            <option value="1">1점</option>
                                            <option value="2">2점</option>
                                            <option value="3">3점</option>
                                            <option value="4">4점</option>
                                            <option value="5">5점</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            의료법 점수
                                        </label>
                                        <select
                                            value={filterLegalScore}
                                            onChange={(e) => setFilterLegalScore(e.target.value)}
                                            className="w-full p-2 border border-gray-300 rounded-md"
                                        >
                                            <option value="">전체</option>
                                            <option value="1">1점</option>
                                            <option value="2">2점</option>
                                            <option value="3">3점</option>
                                            <option value="4">4점</option>
                                            <option value="5">5점</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                            
                            {isLoading ? (
                                <div className="text-center py-8">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
                                    <p className="mt-2 text-gray-500">로딩 중...</p>
                                </div>
                            ) : filteredPosts.length === 0 ? (
                                <div className="text-center py-8 text-gray-500">
                                    <FileText size={48} className="mx-auto mb-4" />
                                    <p>{completedPosts.length === 0 ? '완료된 포스팅이 없습니다.' : '검색 결과가 없습니다.'}</p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {filteredPosts.map((post) => {
                                        const fields = post.fields;
                                        const contentScore = fields.QA_content_score || 0;
                                        const legalScore = fields.QA_legal_score || 0;
                                        const hasQA = fields.QA_yn || false;
                                        const scoreColor = getScoreColor(contentScore, legalScore, hasQA);
                                        
                                        return (
                                            <div
                                                key={post.id}
                                                id={`post-${post.id}`}
                                                onClick={() => handlePostSelect(post)}
                                                className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                                                    selectedPost?.id === post.id
                                                        ? 'border-blue-500 bg-blue-50'
                                                        : scoreColor
                                                }`}
                                            >
                                                <div className="flex justify-between items-start">
                                                    <div className="flex-1">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <span className="text-xs font-mono bg-gray-100 px-2 py-1 rounded text-gray-600">
                                                                {fields['Post Id']}
                                                            </span>
                                                        </div>
                                                        <h4 className="font-medium truncate">
                                                            {fields.Title || '제목 없음'}
                                                        </h4>
                                                        <p className="text-sm text-gray-500 mt-1">
                                                            {fields['Treatment Type']} • {fields.Status}
                                                        </p>
                                                        <p className="text-xs text-gray-400 mt-1">
                                                            {new Date(fields['Updated At']).toLocaleString()}
                                                        </p>
                                                    </div>
                                                    
                                                    {/* QA 정보 영역 */}
                                                    <div className="ml-4 text-right text-xs">
                                                        <div className="space-y-1">
                                                            <div className={`px-2 py-1 rounded ${fields.QA_yn ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                                                                {fields.QA_yn ? 'QA 완료' : 'QA 미완료'}
                                                            </div>
                                                            {fields.QA_by && (
                                                                <div className="text-gray-600">
                                                                    담당: {fields.QA_by}
                                                                </div>
                                                            )}
                                                            {fields.QA_content_score > 0 && (
                                                                <div className="text-gray-600">
                                                                    컨텐츠: {contentScore}점
                                                                </div>
                                                            )}
                                                            {fields.QA_legal_score > 0 && (
                                                                <div className="text-gray-600">
                                                                    의료법: {legalScore}점
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                                
                                                {/* 선택된 포스팅의 QA 검토 폼 */}
                                                {selectedPost?.id === post.id && (
                                                    <div className="mt-4 pt-4 border-t border-gray-200">
                                                        <div className="flex items-center justify-between mb-3">
                                                            <h5 className="font-medium">QA 검토</h5>
                                                            <span className="text-xs font-mono bg-blue-100 px-2 py-1 rounded text-blue-600">
                                                                {fields['Post Id']}
                                                            </span>
                                                        </div>
                                                        
                                                        {/* 검토자 선택 */}
                                                        <div className="mb-4">
                                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                                검토자
                                                            </label>
                                                            <div className="space-y-2">
                                                                <div className="flex gap-2">
                                                                    <select
                                                                        value={qaData.reviewer}
                                                                        onChange={(e) => {
                                                                            if (e.target.value === 'new') {
                                                                                setShowNewReviewerInput(true);
                                                                            } else {
                                                                                setQaData(prev => ({ ...prev, reviewer: e.target.value }));
                                                                            }
                                                                        }}
                                                                        className="flex-1 p-2 border border-gray-300 rounded-md"
                                                                    >
                                                                        <option value="">검토자 선택</option>
                                                                        {reviewerOptions.map((reviewer) => (
                                                                            <option key={reviewer} value={reviewer}>
                                                                                {reviewer}
                                                                            </option>
                                                                        ))}
                                                                        <option value="new" className="text-blue-600 font-medium">
                                                                            + 신규 입력
                                                                        </option>
                                                                    </select>
                                                                                                                                    <button
                                                                    onClick={() => saveQAData('reviewer')}
                                                                    disabled={isSavingQA || !qaData.reviewer}
                                                                    className={`px-4 py-2 rounded transition-colors ${
                                                                        savedFields.has('reviewer')
                                                                            ? 'bg-green-500 text-white hover:bg-green-600'
                                                                            : 'bg-blue-500 text-white hover:bg-blue-600 disabled:bg-gray-400'
                                                                    }`}
                                                                >
                                                                    {savedFields.has('reviewer') ? '저장완료' : '저장'}
                                                                </button>
                                                                </div>
                                                                
                                                                {/* 신규 검토자 입력 */}
                                                                {showNewReviewerInput && (
                                                                    <div className="flex gap-2 p-3 bg-gray-50 rounded-md">
                                                                        <input
                                                                            type="text"
                                                                            value={newReviewerName}
                                                                            onChange={(e) => setNewReviewerName(e.target.value)}
                                                                            placeholder="새로운 검토자 이름을 입력하세요"
                                                                            className="flex-1 p-2 border border-gray-300 rounded-md"
                                                                            onKeyPress={(e) => {
                                                                                if (e.key === 'Enter') {
                                                                                    addNewReviewer();
                                                                                }
                                                                            }}
                                                                        />
                                                                        <button
                                                                            onClick={addNewReviewer}
                                                                            disabled={!newReviewerName.trim()}
                                                                            className="px-3 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-400"
                                                                        >
                                                                            추가
                                                                        </button>
                                                                        <button
                                                                            onClick={() => {
                                                                                setShowNewReviewerInput(false);
                                                                                setNewReviewerName('');
                                                                            }}
                                                                            className="px-3 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                                                                        >
                                                                            취소
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                        
                                                        {/* 내용검토 */}
                                                        <div className="mb-4">
                                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                                내용검토
                                                            </label>
                                                            <div className="relative">
                                                                <textarea
                                                                    value={qaData.contentReview}
                                                                    onChange={(e) => setQaData(prev => ({ ...prev, contentReview: e.target.value }))}
                                                                    placeholder="제목이나 본문에 대한 검토 의견을 작성해주세요"
                                                                    className="w-full p-2 border border-gray-300 rounded-md"
                                                                    rows={3}
                                                                />
                                                                <div className="absolute bottom-2 right-2 flex items-center gap-2">
                                                                    <div className="flex items-center gap-1">
                                                                        <span className="text-xs text-gray-500">점수:</span>
                                                                        <div className="flex">
                                                                            {[1, 2, 3, 4, 5].map((star) => (
                                                                                <button
                                                                                    key={star}
                                                                                    onClick={() => setQaData(prev => ({ ...prev, contentScore: star }))}
                                                                                    className={`text-lg ${star <= qaData.contentScore ? 'text-yellow-400' : 'text-gray-300'}`}
                                                                                >
                                                                                    ★
                                                                                </button>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                    <button
                                                                        onClick={() => saveQAData('content')}
                                                                        disabled={isSavingQA || (!qaData.contentReview && qaData.contentScore === 0)}
                                                                        className={`px-3 py-1 text-white text-xs rounded transition-colors ${
                                                                            savedFields.has('content')
                                                                                ? 'bg-green-500 hover:bg-green-600'
                                                                                : 'bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400'
                                                                        }`}
                                                                    >
                                                                        {savedFields.has('content') ? '저장완료' : '저장'}
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        
                                                        {/* 의료법검토 */}
                                                        <div className="mb-4">
                                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                                의료법검토
                                                            </label>
                                                            <div className="relative">
                                                                <textarea
                                                                    value={qaData.legalReview}
                                                                    onChange={(e) => setQaData(prev => ({ ...prev, legalReview: e.target.value }))}
                                                                    placeholder="의료법에 대한 검토 의견을 작성해주세요"
                                                                    className="w-full p-2 border border-gray-300 rounded-md"
                                                                    rows={3}
                                                                />
                                                                <div className="absolute bottom-2 right-2 flex items-center gap-2">
                                                                    <div className="flex items-center gap-1">
                                                                        <span className="text-xs text-gray-500">점수:</span>
                                                                        <div className="flex">
                                                                            {[1, 2, 3, 4, 5].map((star) => (
                                                                                <button
                                                                                    key={star}
                                                                                    onClick={() => setQaData(prev => ({ ...prev, legalScore: star }))}
                                                                                    className={`text-lg ${star <= qaData.legalScore ? 'text-yellow-400' : 'text-gray-300'}`}
                                                                                >
                                                                                    ★
                                                                                </button>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                    <button
                                                                        onClick={() => saveQAData('legal')}
                                                                        disabled={isSavingQA || (!qaData.legalReview && qaData.legalScore === 0)}
                                                                        className={`px-3 py-1 text-white text-xs rounded transition-colors ${
                                                                            savedFields.has('legal')
                                                                                ? 'bg-green-500 hover:bg-green-600'
                                                                                : 'bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400'
                                                                        }`}
                                                                    >
                                                                        {savedFields.has('legal') ? '저장완료' : '저장'}
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        
                                                        {/* 기타 */}
                                                        <div className="mb-4">
                                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                                기타
                                                            </label>
                                                            <div className="relative">
                                                                <textarea
                                                                    value={qaData.etcReview}
                                                                    onChange={(e) => setQaData(prev => ({ ...prev, etcReview: e.target.value }))}
                                                                    placeholder="기타 검토 의견을 작성해주세요"
                                                                    className="w-full p-2 border border-gray-300 rounded-md"
                                                                    rows={3}
                                                                />
                                                                <div className="absolute bottom-2 right-2">
                                                                    <button
                                                                        onClick={() => saveQAData('etc')}
                                                                        disabled={isSavingQA || !qaData.etcReview}
                                                                        className={`px-3 py-1 text-white text-xs rounded transition-colors ${
                                                                            savedFields.has('etc')
                                                                                ? 'bg-green-500 hover:bg-green-600'
                                                                                : 'bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400'
                                                                        }`}
                                                                    >
                                                                        {savedFields.has('etc') ? '저장완료' : '저장'}
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                );
                
            case 'manual':
                return (
                    <div className="flex-1 overflow-auto">
                        <div className="p-4">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    <h3 className="text-lg font-semibold">수동 생성하기</h3>
                                    {currentPostId && (
                                        <span className="text-xs font-mono bg-blue-100 px-2 py-1 rounded text-blue-600">
                                            {currentPostId}
                                        </span>
                                    )}
                                </div>
                                <button
                                    onClick={loadRandomData}
                                    className="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 transition-colors text-sm"
                                >
                                    기존 데이터 불러오기
                                </button>
                            </div>
                            
                            {/* 진료 유형 선택 */}
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    진료 유형
                                </label>
                                <select
                                    value={formData.treatmentType}
                                    onChange={(e) => setFormData(prev => ({ ...prev, treatmentType: e.target.value }))}
                                    className="w-full p-2 border border-gray-300 rounded-md"
                                >
                                    <option value="신경치료">신경치료</option>
                                    <option value="임플란트">임플란트</option>
                                    <option value="교정치료">교정치료</option>
                                    <option value="보철치료">보철치료</option>
                                    <option value="예방치료">예방치료</option>
                                </select>
                            </div>

                            {/* 안내 메시지 */}
                            <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded-r-lg mb-6">
                                <div className="flex">
                                    <div className="py-1">
                                        <Info className="h-6 w-6 text-blue-500 mr-3" />
                                    </div>
                                    <div>
                                        <p className="font-bold text-blue-800">
                                            자료를 제공해주세요
                                        </p>
                                        <p className="text-sm text-blue-700 mt-1">
                                            아래 각 항목에 들어갈 내용과 사진을 제공해주시면, 저희가 멋진 콘텐츠로 제작해드리겠습니다.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* 질문 입력 */}
                            <div className="space-y-6">
                                <div>
                                    <label className="block font-bold mb-2 text-gray-800">
                                        1. 질환에 대한 개념 설명에서 강조되어야 할 메시지가 있나요?
                                    </label>
                                    <textarea
                                        value={formData.questions[0]}
                                        onChange={(e) => {
                                            const newQuestions = [...formData.questions];
                                            newQuestions[0] = e.target.value;
                                            setFormData(prev => ({ ...prev, questions: newQuestions }));
                                        }}
                                        rows={3}
                                        placeholder="예: 신경치료가 자연치를 보존하는 마지막 기회라는 점을 강조하고 싶습니다."
                                        className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                    />
                                </div>

                                <div>
                                    <label className="block font-bold mb-2 text-gray-800">
                                        2. 환자는 처음 내원 시 어떤 상태였나요?
                                    </label>
                                    <textarea
                                        value={formData.questions[1]}
                                        onChange={(e) => {
                                            const newQuestions = [...formData.questions];
                                            newQuestions[1] = e.target.value;
                                            setFormData(prev => ({ ...prev, questions: newQuestions }));
                                        }}
                                        rows={3}
                                        placeholder="예: 5년 전 치료받은 어금니에 극심한 통증과 함께 잇몸이 부어오른 상태로 내원하셨습니다."
                                        className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                    />
                                </div>

                                <div>
                                    <label className="block font-bold mb-2 text-gray-800">
                                        3. 내원 시 찍은 사진을 업로드 후 간단한 설명을 작성해주세요
                                    </label>
                                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                        <div 
                                            className="md:col-span-1 border-2 border-dashed border-gray-300 rounded-lg p-6 text-center bg-gray-50 hover:bg-gray-100 cursor-pointer transition-colors flex flex-col justify-center items-center"
                                            onClick={() => document.getElementById('beforeImages')?.click()}
                                        >
                                            <Upload className="mx-auto text-gray-400" size={28} />
                                            <input 
                                                id="beforeImages"
                                                type="file" 
                                                className="hidden" 
                                                multiple 
                                                accept="image/*"
                                                onChange={(e) => handleImageUpload(e.target.files, 'before')}
                                            />
                                        </div>
                                        <div className="md:col-span-3">
                                            <textarea
                                                value={formData.questions[5]}
                                                onChange={(e) => {
                                                    const newQuestions = [...formData.questions];
                                                    newQuestions[5] = e.target.value;
                                                    setFormData(prev => ({ ...prev, questions: newQuestions }));
                                                }}
                                                rows={4}
                                                placeholder="파노라마, X-ray, 구강 내 사진 등과 함께 어떤 상태였는지 간략하게 작성해주세요. 예: 초진 시 촬영한 파노라마 사진. 16번 치아 주변으로 광범위한 염증 소견이 관찰됨."
                                                className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none h-full"
                                            />
                                        </div>
                                    </div>
                                    {formData.beforeImages.length > 0 && (
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            {formData.beforeImages.map((file, index) => (
                                                <div key={index} className="relative">
                                                    <img 
                                                        src={URL.createObjectURL(file)} 
                                                        alt={`Before ${index + 1}`}
                                                        className="w-16 h-16 object-cover rounded border"
                                                    />
                                                    <button
                                                        onClick={() => removeImage(index, 'before')}
                                                        className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs"
                                                    >
                                                        ×
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div>
                                    <label className="block font-bold mb-2 text-gray-800">
                                        4. 치료 과정에서 강조되어야 할 메시지가 있나요?
                                    </label>
                                    <textarea
                                        value={formData.questions[2]}
                                        onChange={(e) => {
                                            const newQuestions = [...formData.questions];
                                            newQuestions[2] = e.target.value;
                                            setFormData(prev => ({ ...prev, questions: newQuestions }));
                                        }}
                                        rows={3}
                                        placeholder="예: 미세 현미경을 사용하여 염증의 원인을 정확히 찾아내고, MTA 재료를 이용해 성공률을 높였습니다."
                                        className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                    />
                                </div>

                                <div>
                                    <label className="block font-bold mb-2 text-gray-800">
                                        5. 치료 과정 사진을 업로드 후 간단한 설명을 작성해주세요
                                    </label>
                                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                        <div 
                                            className="md:col-span-1 border-2 border-dashed border-gray-300 rounded-lg p-6 text-center bg-gray-50 hover:bg-gray-100 cursor-pointer transition-colors flex flex-col justify-center items-center"
                                            onClick={() => document.getElementById('processImages')?.click()}
                                        >
                                            <Upload className="mx-auto text-gray-400" size={28} />
                                            <input 
                                                id="processImages"
                                                type="file" 
                                                className="hidden" 
                                                multiple 
                                                accept="image/*"
                                                onChange={(e) => handleImageUpload(e.target.files, 'process')}
                                            />
                                        </div>
                                        <div className="md:col-span-3">
                                            <textarea
                                                value={formData.questions[6]}
                                                onChange={(e) => {
                                                    const newQuestions = [...formData.questions];
                                                    newQuestions[6] = e.target.value;
                                                    setFormData(prev => ({ ...prev, questions: newQuestions }));
                                                }}
                                                rows={4}
                                                placeholder="미세 현미경 사용 모습, MTA 충전 과정 등 치료 과정 사진과 함께 설명을 작성해주세요. 예: 미세현미경을 사용하여 근관 내부를 탐색하는 모습."
                                                className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none h-full"
                                            />
                                        </div>
                                    </div>
                                    {formData.processImages.length > 0 && (
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            {formData.processImages.map((file, index) => (
                                                <div key={index} className="relative">
                                                    <img 
                                                        src={URL.createObjectURL(file)} 
                                                        alt={`Process ${index + 1}`}
                                                        className="w-16 h-16 object-cover rounded border"
                                                    />
                                                    <button
                                                        onClick={() => removeImage(index, 'process')}
                                                        className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs"
                                                    >
                                                        ×
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div>
                                    <label className="block font-bold mb-2 text-gray-800">
                                        6. 치료 결과에 대해 강조되어야 할 메시지가 있나요?
                                    </label>
                                    <textarea
                                        value={formData.questions[3]}
                                        onChange={(e) => {
                                            const newQuestions = [...formData.questions];
                                            newQuestions[3] = e.target.value;
                                            setFormData(prev => ({ ...prev, questions: newQuestions }));
                                        }}
                                        rows={3}
                                        placeholder="예: 치료 후 통증이 완전히 사라졌으며, 1년 후 검진에서도 재발 없이 안정적으로 유지되고 있습니다."
                                        className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                    />
                                </div>

                                <div>
                                    <label className="block font-bold mb-2 text-gray-800">
                                        7. 치료 결과 사진을 업로드 후 간단한 설명을 작성해주세요
                                    </label>
                                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                        <div 
                                            className="md:col-span-1 border-2 border-dashed border-gray-300 rounded-lg p-6 text-center bg-gray-50 hover:bg-gray-100 cursor-pointer transition-colors flex flex-col justify-center items-center"
                                            onClick={() => document.getElementById('afterImages')?.click()}
                                        >
                                            <Upload className="mx-auto text-gray-400" size={28} />
                                            <input 
                                                id="afterImages"
                                                type="file" 
                                                className="hidden" 
                                                multiple 
                                                accept="image/*"
                                                onChange={(e) => handleImageUpload(e.target.files, 'after')}
                                            />
                                        </div>
                                        <div className="md:col-span-3">
                                            <textarea
                                                value={formData.questions[7]}
                                                onChange={(e) => {
                                                    const newQuestions = [...formData.questions];
                                                    newQuestions[7] = e.target.value;
                                                    setFormData(prev => ({ ...prev, questions: newQuestions }));
                                                }}
                                                rows={4}
                                                placeholder="치료 전/후 비교 X-ray, 구강 내 사진 등 치료 결과 사진과 함께 설명을 작성해주세요. 예: 신경치료 완료 후 촬영한 파노라마 사진. 염증이 모두 제거되고 근관이 완벽하게 충전된 것을 확인할 수 있음."
                                                className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none h-full"
                                            />
                                        </div>
                                    </div>
                                    {formData.afterImages.length > 0 && (
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            {formData.afterImages.map((file, index) => (
                                                <div key={index} className="relative">
                                                    <img 
                                                        src={URL.createObjectURL(file)} 
                                                        alt={`After ${index + 1}`}
                                                        className="w-16 h-16 object-cover rounded border"
                                                    />
                                                    <button
                                                        onClick={() => removeImage(index, 'after')}
                                                        className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs"
                                                    >
                                                        ×
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div>
                                    <label className="block font-bold mb-2 text-gray-800">
                                        8. 추가적으로 더하고 싶은 메시지가 있나요?
                                    </label>
                                    <textarea
                                        value={formData.questions[4]}
                                        onChange={(e) => {
                                            const newQuestions = [...formData.questions];
                                            newQuestions[4] = e.target.value;
                                            setFormData(prev => ({ ...prev, questions: newQuestions }));
                                        }}
                                        rows={3}
                                        placeholder="환자 당부사항, 병원 철학 등 자유롭게 작성해주세요."
                                        className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                    />
                                </div>
                            </div>



                            {/* 생성하기 버튼 */}
                            <button
                                onClick={handleSubmit}
                                disabled={isProcessing}
                                className="w-full bg-blue-500 text-white py-2 px-4 rounded-md hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {isProcessing ? (
                                    <>
                                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                        처리 중...
                                    </>
                                ) : (
                                    <>
                                        <Send size={16} />
                                        생성하기
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                );
                
            case 'auto':
                return (
                    <div className="flex-1 overflow-auto">
                        <div className="p-4">
                            <h3 className="text-lg font-semibold mb-4">자동 생성하기</h3>
                            
                            {/* 진료 유형 선택 */}
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    진료 유형
                                </label>
                                <select
                                    value={autoFormData.treatmentType}
                                    onChange={(e) => setAutoFormData(prev => ({ ...prev, treatmentType: e.target.value }))}
                                    className="w-full p-2 border border-gray-300 rounded-md"
                                    disabled={autoProcessing}
                                >
                                    <option value="신경치료">신경치료</option>
                                    <option value="임플란트">임플란트</option>
                                    <option value="교정치료">교정치료</option>
                                    <option value="보철치료">보철치료</option>
                                    <option value="예방치료">예방치료</option>
                                </select>
                            </div>

                            {/* 생성 개수 입력 */}
                            <div className="mb-6">
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    생성할 포스팅 개수
                                </label>
                                <div className="flex items-center space-x-3">
                                    <input
                                        type="number"
                                        min="1"
                                        max="100"
                                        value={autoFormData.count}
                                        onChange={(e) => {
                                            const value = parseInt(e.target.value) || 1;
                                            const clampedValue = Math.max(1, Math.min(100, value));
                                            setAutoFormData(prev => ({ ...prev, count: clampedValue }));
                                        }}
                                        className="flex-1 p-2 border border-gray-300 rounded-md"
                                        disabled={autoProcessing}
                                        placeholder="1-100"
                                    />
                                    <span className="text-sm text-gray-500 whitespace-nowrap">
                                        개
                                    </span>
                                </div>
                                
                                {/* 슬라이더 */}
                                <div className="mt-3">
                                    <input
                                        type="range"
                                        min="1"
                                        max="100"
                                        step="10"
                                        value={autoFormData.count}
                                        onChange={(e) => setAutoFormData(prev => ({ ...prev, count: parseInt(e.target.value) }))}
                                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
                                        disabled={autoProcessing}
                                    />
                                    <div className="flex justify-between text-xs text-gray-500 mt-1">
                                        <span>1</span>
                                        <span>10</span>
                                        <span>20</span>
                                        <span>30</span>
                                        <span>40</span>
                                        <span>50</span>
                                        <span>60</span>
                                        <span>70</span>
                                        <span>80</span>
                                        <span>90</span>
                                        <span>100</span>
                                    </div>
                                </div>
                                
                                <p className="text-xs text-gray-500 mt-2">1-100개까지 생성 가능합니다. (10개 단위로 슬라이더 조정 가능)</p>
                            </div>

                            {/* 자동 생성 버튼들 */}
                            <div className="space-y-2">
                                <button
                                    onClick={handleAutoGeneration}
                                    disabled={autoProcessing}
                                    className={`w-full py-3 px-4 rounded-md font-medium transition-colors ${
                                        autoProcessing
                                            ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                            : 'bg-blue-500 text-white hover:bg-blue-600'
                                    }`}
                                >
                                    {autoProcessing ? (
                                        <>
                                            <RefreshCw className="inline-block w-4 h-4 mr-2 animate-spin" />
                                            자동 생성 중...
                                        </>
                                    ) : (
                                        <>
                                            <Play className="inline-block w-4 h-4 mr-2" />
                                            자동 생성하기
                                        </>
                                    )}
                                </button>
                                
                                <button
                                    onClick={async () => {
                                        const postId = prompt('테스트할 Post ID를 입력하세요 (예: QA_xxxxx):');
                                        if (postId) {
                                            addLog(`🧪 Post ID ${postId} 수동 에이전트 호출 테스트...`);
                                            try {
                                                const response = await fetch(`${API_BASE_URL}/api/process-post`, {
                                                    method: 'POST',
                                                    headers: {
                                                        'Content-Type': 'application/json'
                                                    },
                                                    body: JSON.stringify({
                                                        post_id: postId
                                                    })
                                                });
                                                
                                                if (response.ok) {
                                                    const result = await response.json();
                                                    addLog(`✅ 수동 에이전트 호출 성공: ${JSON.stringify(result)}`);
                                                } else {
                                                    const errorText = await response.text();
                                                    addLog(`❌ 수동 에이전트 호출 실패: ${response.status} - ${errorText}`);
                                                }
                                            } catch (error) {
                                                addLog(`❌ 수동 에이전트 호출 오류: ${error}`);
                                            }
                                        }
                                    }}
                                    className="w-full bg-orange-600 text-white py-2 px-4 rounded-md hover:bg-orange-700 flex items-center justify-center space-x-2"
                                >
                                    <Info size={16} />
                                    <span>수동 에이전트 테스트</span>
                                </button>
                            </div>

                            {/* 진행 상황 표시 */}
                            {autoProcessing && (
                                <div className="mt-4 p-4 bg-blue-50 rounded-lg">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm font-medium text-blue-800">
                                            진행 상황: {autoProgress.current}/{autoProgress.total}
                                        </span>
                                        <span className="text-sm text-blue-600">
                                            완료: {autoProgress.completed}/{autoProgress.total}
                                        </span>
                                    </div>
                                    <div className="w-full bg-blue-200 rounded-full h-2">
                                        <div 
                                            className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                                            style={{ width: `${(autoProgress.current / autoProgress.total) * 100}%` }}
                                        ></div>
                                    </div>
                                    {autoProgress.startTime > 0 && (
                                        <div className="mt-2 text-xs text-blue-600">
                                            소요 시간: {Math.round((Date.now() - autoProgress.startTime) / 1000)}초
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                );
                
            default:
                return null;
        }
    };

    return (
        <div className="min-h-screen bg-gray-50">
            <div 
                id="main-container"
                className="flex h-screen"
                style={{ cursor: isResizing ? 'col-resize' : 'default' }}
            >
                {/* 좌측 패널 */}
                <div 
                    className="bg-white border-r border-gray-200 flex flex-col"
                    style={{ width: `${leftPanelWidth}%` }}
                >
                    {/* 탭 메뉴 */}
                    <div className="border-b border-gray-200">
                        <div className="flex">
                            <button
                                onClick={() => handleTabChange('review')}
                                className={`flex-1 py-3 px-4 text-sm font-medium border-b-2 transition-colors ${
                                    activeTab === 'review'
                                        ? 'border-blue-500 text-blue-600'
                                        : 'border-transparent text-gray-500 hover:text-gray-700'
                                }`}
                            >
                                포스팅 검토
                            </button>
                            <button
                                onClick={() => handleTabChange('manual')}
                                className={`flex-1 py-3 px-4 text-sm font-medium border-b-2 transition-colors ${
                                    activeTab === 'manual'
                                        ? 'border-blue-500 text-blue-600'
                                        : 'border-transparent text-gray-500 hover:text-gray-700'
                                }`}
                            >
                                포스팅 수동 생성
                            </button>
                            <button
                                onClick={() => handleTabChange('auto')}
                                className={`flex-1 py-3 px-4 text-sm font-medium border-b-2 transition-colors ${
                                    activeTab === 'auto'
                                        ? 'border-blue-500 text-blue-600'
                                        : 'border-transparent text-gray-500 hover:text-gray-700'
                                }`}
                            >
                                포스팅 자동 생성
                            </button>
                        </div>
                    </div>
                    
                    {/* 탭 콘텐츠 */}
                    {renderTabContent()}
                </div>

                {/* 리사이즈 핸들 */}
                <div
                    className="w-1 bg-gray-300 hover:bg-blue-400 cursor-col-resize flex items-center justify-center transition-colors"
                    onMouseDown={handleMouseDown}
                >
                    <div className="w-0.5 h-8 bg-gray-400 rounded-full"></div>
                </div>

                {/* 우측 패널 */}
                <div 
                    className="bg-white flex flex-col"
                    style={{ width: `${100 - leftPanelWidth}%` }}
                >
                    {(isProcessing || autoProcessing) ? (
                        // 작업 진행 중일 때 로그 표시
                        <div className="flex-1 overflow-auto">
                            <div className="p-4">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-lg font-semibold">
                                        {autoProcessing ? '자동 생성 진행 상황' : '작업 진행 상황'}
                                    </h3>
                                    <div className="flex space-x-2">
                                        <button
                                            onClick={() => setLogs([])}
                                            className="px-3 py-1 text-xs bg-gray-200 hover:bg-gray-300 rounded"
                                        >
                                            로그 초기화
                                        </button>
                                    </div>
                                </div>

                                {/* 자동 생성 진행 상황 표시 */}
                                {(autoProcessing || autoProgress.isCompleted) && (
                                    <div className={`mb-4 p-4 rounded-lg ${autoProgress.isCompleted ? 'bg-green-50' : 'bg-blue-50'}`}>
                                        <div className="flex items-center justify-between mb-2">
                                            <span className={`text-sm font-medium ${autoProgress.isCompleted ? 'text-green-800' : 'text-blue-800'}`}>
                                                {autoProgress.isCompleted 
                                                    ? `✅ 전체 ${autoProgress.total}개 작업 완료!` 
                                                    : `전체 ${autoProgress.total}개 중 ${autoProgress.current}개 진행 중`
                                                }
                                            </span>
                                            <span className={`text-sm ${autoProgress.isCompleted ? 'text-green-600' : 'text-blue-600'}`}>
                                                완료: {autoProgress.completed}/{autoProgress.total}
                                            </span>
                                        </div>
                                        <div className={`w-full rounded-full h-3 ${autoProgress.isCompleted ? 'bg-green-200' : 'bg-blue-200'}`}>
                                            <div 
                                                className={`h-3 rounded-full transition-all duration-300 ${autoProgress.isCompleted ? 'bg-green-500' : 'bg-blue-500'}`}
                                                style={{ width: `${autoProgress.isCompleted ? 100 : (autoProgress.current / autoProgress.total) * 100}%` }}
                                            ></div>
                                        </div>
                                        {autoProgress.startTime > 0 && (
                                            <div className="mt-2 text-xs text-blue-600">
                                                소요 시간: {Math.round((Date.now() - autoProgress.startTime) / 1000)}초
                                            </div>
                                        )}
                                    </div>
                                )}
                                
                                {/* 로그 창 - 최대 높이 제한 */}
                                <div className="bg-gray-900 text-green-400 p-4 rounded-lg font-mono text-sm overflow-auto" style={{ maxHeight: 'calc(100vh - 200px)', minHeight: '400px' }}>
                                    {logs.map((log, index) => (
                                        <div key={index} className="mb-1">
                                            {log}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ) : (activeTab === 'manual' || activeTab === 'auto') && !selectedPost ? (
                        // 수동 생성 또는 자동 생성 탭일 때 빈 로그 화면 표시 (selectedPost가 없을 때만)
                        <div className="flex-1 overflow-auto">
                            <div className="p-4">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-lg font-semibold">
                                        {activeTab === 'manual' ? '수동 생성 로그' : '자동 생성 로그'}
                                    </h3>
                                    <div className="flex space-x-2">
                                        <button
                                            onClick={() => setLogs([])}
                                            className="px-3 py-1 text-xs bg-gray-200 hover:bg-gray-300 rounded"
                                        >
                                            로그 초기화
                                        </button>
                                    </div>
                                </div>
                                
                                {/* 로그 창 - 최대 높이 제한 */}
                                <div className="bg-gray-900 text-green-400 p-4 rounded-lg font-mono text-sm overflow-auto" style={{ maxHeight: 'calc(100vh - 200px)', minHeight: '400px' }}>
                                    {logs.length > 0 ? (
                                        logs.map((log, index) => (
                                            <div key={index} className="mb-1">
                                                {log}
                                            </div>
                                        ))
                                    ) : (
                                        <div className="text-gray-500">
                                            {activeTab === 'manual' 
                                                ? '수동 생성 버튼을 클릭하면 여기에 로그가 표시됩니다.' 
                                                : '자동 생성 버튼을 클릭하면 여기에 로그가 표시됩니다.'
                                            }
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : selectedPost ? (
                        // 완료된 포스팅 HTML 렌더링 (수동 생성 완료 후)
                        <div className="flex-1 overflow-auto">
                            <div className="p-4">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-lg font-semibold">
                                        {selectedPost.fields.Title || selectedPost.fields['Post Id']}
                                    </h3>
                                    <div className="flex items-center space-x-2">
                                        <span className="text-xs font-mono bg-green-100 px-2 py-1 rounded text-green-600">
                                            {selectedPost.fields['Post Id']}
                                        </span>
                                        {(activeTab === 'manual' || activeTab === 'auto') && (
                                            <button
                                                onClick={() => setSelectedPost(null)}
                                                className="px-2 py-1 text-xs bg-gray-200 hover:bg-gray-300 rounded"
                                            >
                                                로그로 돌아가기
                                            </button>
                                        )}
                                    </div>
                                </div>
                                {selectedPost.fields.Content ? (
                                    <div 
                                        className="prose max-w-none"
                                        style={{
                                            maxWidth: '100%',
                                            overflowX: 'hidden',
                                            wordWrap: 'break-word'
                                        }}
                                        dangerouslySetInnerHTML={{ 
                                            __html: selectedPost.fields.Content.replace(
                                                /<img[^>]+src="([^"]*)"[^>]*>/gi,
                                                (match: string, src: string) => {
                                                    // 상대 경로나 로컬 경로인 경우 기본 이미지로 대체
                                                    if (src.startsWith('/') || src.startsWith('./') || src.startsWith('../') || !src.startsWith('http')) {
                                                        return match.replace(src, 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjE1MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjNmNGY2Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzk5YWFhYSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkltYWdlPC90ZXh0Pjwvc3ZnPg==');
                                                    }
                                                    return match;
                                                }
                                            )
                                        }}
                                    />
                                ) : (
                                    <div className="text-center py-8 text-gray-500">
                                        <FileText size={48} className="mx-auto mb-4" />
                                        <p>콘텐츠가 없습니다.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        // 기본 상태
                        <div className="flex-1 flex items-center justify-center">
                            <div className="text-center text-gray-500">
                                <FileText size={48} className="mx-auto mb-4" />
                                <p className="text-xl font-semibold">콘텐츠 미선택</p>
                                <p>좌측에서 포스팅을 선택하거나 생성해주세요.</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
