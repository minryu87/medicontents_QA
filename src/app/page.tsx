'use client';

import React, { useState, ChangeEvent, useEffect } from 'react';
import { Upload, Send, FileText, CheckCircle, XCircle, X, RefreshCw, Play, Info } from 'lucide-react';

// Airtable 설정
const AIRTABLE_API_KEY = 'pat6S8lzX8deRFTKC.0e92c4403cdc7878f8e61f815260852d4518a0b46fa3de2350e5e91f4f0f6af9';
const AIRTABLE_BASE_ID = 'appa5Q0PYdL5VY3RK';

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
    console.log('업데이트할 데이터:', { postId, qaData });
    
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
        console.log('이미지 업로드 성공:', result);
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

    // 완료된 포스팅 목록 로드
    useEffect(() => {
        if (activeTab === 'review') {
            loadCompletedPosts();
        }
    }, [activeTab]);

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

    // 로그 추가 함수
    const addLog = (message: string) => {
        setLogs(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`]);
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
        try {
            setIsProcessing(true);
            setLogs([]);
            addLog('포스팅 생성 시작...');
            
            const postId = generatePostId();
            setCurrentPostId(postId);
            addLog(`Post ID 생성: ${postId}`);

            // 1. Medicontent Posts 테이블에 데이터 생성
            addLog('Medicontent Posts 테이블에 데이터 생성 중...');
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
            addLog('Medicontent Posts 생성 완료');

            // 2. Post Data Requests 테이블에 데이터 생성
            addLog('Post Data Requests 테이블에 데이터 생성 중...');
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
            addLog('Post Data Requests 생성 완료');

            // 3. 이미지 업로드
            addLog('이미지 업로드 시작...');
            const allImages = [
                ...formData.beforeImages.map(file => ({ file, field: 'Before Images' })),
                ...formData.processImages.map(file => ({ file, field: 'Process Images' })),
                ...formData.afterImages.map(file => ({ file, field: 'After Images' }))
            ];

            for (const { file, field } of allImages) {
                try {
                    await uploadImageToAirtable(file, recordId, field);
                    addLog(`${field} 이미지 업로드 완료: ${file.name}`);
                } catch (error) {
                    addLog(`${field} 이미지 업로드 실패: ${file.name}`);
                }
            }

            // 4. Agent 실행
            addLog('AI Agent 실행 시작...');
            const agentResponse = await fetch('http://localhost:8000/api/process-post', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ post_id: postId })
            });

            if (agentResponse.ok) {
                const agentData = await agentResponse.json();
                addLog('AI Agent 실행 완료');
                addLog(`Agent 응답: ${JSON.stringify(agentData, null, 2)}`);
                
                // 5. n8n 완료 확인 (폴링)
                addLog('n8n 워크플로우 완료 대기 중...');
                let isCompleted = false;
                let attempts = 0;
                const maxAttempts = 60; // 5분 대기
                
                while (!isCompleted && attempts < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 5000)); // 5초 대기
                    attempts++;
                    
                    try {
                        addLog(`n8n 완료 확인 시도 ${attempts}/${maxAttempts}...`);
                        const completionResponse = await fetch(`http://localhost:8000/api/n8n-completion`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                post_id: postId,
                                workflow_id: 'medicontent_autoblog_QA_manual',
                                timestamp: new Date().toISOString(),
                                n8n_result: 'success'
                            })
                        });
                        
                        if (completionResponse.ok) {
                            const completionData = await completionResponse.json();
                            addLog(`n8n 응답: ${JSON.stringify(completionData, null, 2)}`);
                            
                            if (completionData.is_completed) {
                                addLog('n8n 워크플로우 완료 확인됨');
                                addLog('후속 작업 완료');
                                
                                // 완료된 포스팅을 자동으로 선택하여 HTML 렌더링
                                try {
                                    const completedPostsResponse = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Medicontent%20Posts?filterByFormula={Post Id}="${postId}"`, {
                                        headers: {
                                            'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
                                            'Content-Type': 'application/json'
                                        }
                                    });
                                    
                                    if (completedPostsResponse.ok) {
                                        const data = await completedPostsResponse.json();
                                        if (data.records && data.records.length > 0) {
                                            setSelectedPost(data.records[0]);
                                            addLog('완료된 포스팅을 우측 패널에 표시합니다.');
                                        }
                                    }
                                } catch (error) {
                                    addLog(`포스팅 선택 중 오류: ${error}`);
                                }
                                
                                isCompleted = true;
                            } else {
                                addLog(`n8n 워크플로우 진행 중... (${attempts}/${maxAttempts})`);
                                addLog(`상태: Post Data=${completionData.post_data_status}, Medicontent=${completionData.medicontent_status}`);
                            }
                        } else {
                            addLog(`n8n 완료 확인 실패: ${completionResponse.status}`);
                        }
                    } catch (error) {
                        addLog(`완료 확인 중 오류: ${error}`);
                    }
                }
                
                if (!isCompleted) {
                    addLog('n8n 워크플로우 완료 시간 초과');
                }
            } else {
                const errorText = await agentResponse.text();
                addLog(`AI Agent 실행 실패: ${agentResponse.status} - ${errorText}`);
            }

        } catch (error) {
            addLog(`오류 발생: ${error}`);
        } finally {
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
                                <button
                                    onClick={loadCompletedPosts}
                                    className="p-2 rounded-md hover:bg-gray-100"
                                    disabled={isLoading}
                                >
                                    <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
                                </button>
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
                            <div className="flex items-center gap-2 mb-4">
                                <h3 className="text-lg font-semibold">수동 생성하기</h3>
                                {currentPostId && (
                                    <span className="text-xs font-mono bg-blue-100 px-2 py-1 rounded text-blue-600">
                                        {currentPostId}
                                    </span>
                                )}
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
                            <p className="text-gray-500">자동 생성 기능은 준비 중입니다.</p>
                        </div>
                    </div>
                );
                
            default:
                return null;
        }
    };

    return (
        <div className="min-h-screen bg-gray-50">
            <div className="flex h-screen">
                {/* 좌측 패널 */}
                <div className="w-1/2 bg-white border-r border-gray-200 flex flex-col">
                    {/* 탭 메뉴 */}
                    <div className="border-b border-gray-200">
                        <div className="flex">
                            <button
                                onClick={() => setActiveTab('review')}
                                className={`flex-1 py-3 px-4 text-sm font-medium border-b-2 transition-colors ${
                                    activeTab === 'review'
                                        ? 'border-blue-500 text-blue-600'
                                        : 'border-transparent text-gray-500 hover:text-gray-700'
                                }`}
                            >
                                포스팅 검토
                            </button>
                            <button
                                onClick={() => setActiveTab('manual')}
                                className={`flex-1 py-3 px-4 text-sm font-medium border-b-2 transition-colors ${
                                    activeTab === 'manual'
                                        ? 'border-blue-500 text-blue-600'
                                        : 'border-transparent text-gray-500 hover:text-gray-700'
                                }`}
                            >
                                포스팅 수동 생성
                            </button>
                            <button
                                onClick={() => setActiveTab('auto')}
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

                {/* 우측 패널 */}
                <div className="w-1/2 bg-white flex flex-col">
                    {isProcessing ? (
                        // 작업 진행 중일 때 로그 표시
                        <div className="flex-1 overflow-auto">
                            <div className="p-4">
                                <h3 className="text-lg font-semibold mb-4">작업 진행 상황</h3>
                                <div className="bg-gray-900 text-green-400 p-4 rounded-lg font-mono text-sm h-96 overflow-auto">
                                    {logs.map((log, index) => (
                                        <div key={index} className="mb-1">
                                            {log}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ) : selectedPost ? (
                        // 완료된 포스팅 HTML 렌더링
                        <div className="flex-1 overflow-auto">
                            <div className="p-4">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-lg font-semibold">
                                        {selectedPost.fields.Title || selectedPost.fields['Post Id']}
                                    </h3>
                                    <span className="text-xs font-mono bg-green-100 px-2 py-1 rounded text-green-600">
                                        {selectedPost.fields['Post Id']}
                                    </span>
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
