'use client';

import React, { useState, ChangeEvent, useEffect } from 'react';
import { Upload, Send, FileText, CheckCircle, XCircle, X, RefreshCw, Play } from 'lucide-react';

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
    const [reviewerOptions, setReviewerOptions] = useState<string[]>([
        'YB', 'Min', 'Hani', 'Hyuni', 'Naten'
    ]);
    const [showNewReviewerInput, setShowNewReviewerInput] = useState(false);
    const [newReviewerName, setNewReviewerName] = useState('');
    
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

    // 신규 검토자 추가
    const addNewReviewer = () => {
        if (newReviewerName.trim() && !reviewerOptions.includes(newReviewerName.trim())) {
            setReviewerOptions(prev => [...prev, newReviewerName.trim()].sort());
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
            
            // 목록 새로고침
            await loadCompletedPosts();
            
            alert('저장되었습니다.');
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
        
        // 선택된 포스팅을 상단으로 스크롤
        const postElement = document.getElementById(`post-${post.id}`);
        if (postElement) {
            postElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };

    // 점수에 따른 색상 반환
    const getScoreColor = (contentScore: number, legalScore: number) => {
        if (contentScore <= 1 || legalScore <= 1) return 'bg-red-50 border-red-200';
        if (contentScore <= 3 || legalScore <= 3) return 'bg-yellow-50 border-yellow-200';
        if (contentScore >= 4 && legalScore >= 4) return 'bg-green-50 border-green-200';
        return 'bg-white border-gray-200';
    };

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
                addLog('AI Agent 실행 완료');
                
                // 5. n8n 완료 확인 (폴링)
                addLog('n8n 워크플로우 완료 대기 중...');
                let isCompleted = false;
                let attempts = 0;
                const maxAttempts = 60; // 5분 대기
                
                while (!isCompleted && attempts < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 5000)); // 5초 대기
                    attempts++;
                    
                    try {
                        const completionResponse = await fetch(`http://localhost:8000/api/n8n-completion`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                post_id: postId,
                                workflow_id: 'medicontent_autoblog_QA_manual',
                                timestamp: new Date().toISOString()
                            })
                        });
                        
                        if (completionResponse.ok) {
                            const completionData = await completionResponse.json();
                            if (completionData.is_completed) {
                                addLog('n8n 워크플로우 완료 확인됨');
                                addLog('후속 작업 완료');
                                isCompleted = true;
                            } else {
                                addLog(`n8n 워크플로우 진행 중... (${attempts}/${maxAttempts})`);
                            }
                        }
                    } catch (error) {
                        addLog(`완료 확인 중 오류: ${error}`);
                    }
                }
                
                if (!isCompleted) {
                    addLog('n8n 워크플로우 완료 시간 초과');
                }
            } else {
                addLog('AI Agent 실행 실패');
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
                            
                            {isLoading ? (
                                <div className="text-center py-8">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
                                    <p className="mt-2 text-gray-500">로딩 중...</p>
                                </div>
                            ) : completedPosts.length === 0 ? (
                                <div className="text-center py-8 text-gray-500">
                                    <FileText size={48} className="mx-auto mb-4" />
                                    <p>완료된 포스팅이 없습니다.</p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {completedPosts.map((post) => {
                                        const fields = post.fields;
                                        const contentScore = fields.QA_content_score || 0;
                                        const legalScore = fields.QA_legal_score || 0;
                                        const scoreColor = getScoreColor(contentScore, legalScore);
                                        
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
                                                        <h4 className="font-medium truncate">
                                                            {fields.Title || fields['Post Id']}
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
                                                        <h5 className="font-medium mb-3">QA 검토</h5>
                                                        
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
                                                                        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400"
                                                                    >
                                                                        저장
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
                                                                        className="px-3 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600 disabled:bg-gray-400"
                                                                    >
                                                                        저장
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
                                                                        className="px-3 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600 disabled:bg-gray-400"
                                                                    >
                                                                        저장
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
                                                                        className="px-3 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600 disabled:bg-gray-400"
                                                                    >
                                                                        저장
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
                            <h3 className="text-lg font-semibold mb-4">수동 생성하기</h3>
                            
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

                            {/* 질문 입력 */}
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    질문 및 답변
                                </label>
                                {formData.questions.map((question, index) => (
                                    <div key={index} className="mb-3">
                                        <textarea
                                            value={question}
                                            onChange={(e) => {
                                                const newQuestions = [...formData.questions];
                                                newQuestions[index] = e.target.value;
                                                setFormData(prev => ({ ...prev, questions: newQuestions }));
                                            }}
                                            placeholder={`질문 ${index + 1}`}
                                            className="w-full p-2 border border-gray-300 rounded-md"
                                            rows={3}
                                        />
                                    </div>
                                ))}
                            </div>

                            {/* 이미지 업로드 */}
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    이미지 업로드
                                </label>
                                
                                {/* Before Images */}
                                <div className="mb-3">
                                    <h4 className="text-sm font-medium mb-2">Before Images</h4>
                                    <input
                                        type="file"
                                        multiple
                                        accept="image/*"
                                        onChange={(e) => handleImageUpload(e.target.files, 'before')}
                                        className="w-full p-2 border border-gray-300 rounded-md"
                                    />
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {formData.beforeImages.map((file, index) => (
                                            <div key={index} className="flex items-center gap-2 bg-gray-100 p-2 rounded">
                                                <span className="text-sm truncate">{file.name}</span>
                                                <button
                                                    onClick={() => removeImage(index, 'before')}
                                                    className="text-red-500 hover:text-red-700"
                                                >
                                                    <X size={16} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Process Images */}
                                <div className="mb-3">
                                    <h4 className="text-sm font-medium mb-2">Process Images</h4>
                                    <input
                                        type="file"
                                        multiple
                                        accept="image/*"
                                        onChange={(e) => handleImageUpload(e.target.files, 'process')}
                                        className="w-full p-2 border border-gray-300 rounded-md"
                                    />
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {formData.processImages.map((file, index) => (
                                            <div key={index} className="flex items-center gap-2 bg-gray-100 p-2 rounded">
                                                <span className="text-sm truncate">{file.name}</span>
                                                <button
                                                    onClick={() => removeImage(index, 'process')}
                                                    className="text-red-500 hover:text-red-700"
                                                >
                                                    <X size={16} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* After Images */}
                                <div className="mb-3">
                                    <h4 className="text-sm font-medium mb-2">After Images</h4>
                                    <input
                                        type="file"
                                        multiple
                                        accept="image/*"
                                        onChange={(e) => handleImageUpload(e.target.files, 'after')}
                                        className="w-full p-2 border border-gray-300 rounded-md"
                                    />
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {formData.afterImages.map((file, index) => (
                                            <div key={index} className="flex items-center gap-2 bg-gray-100 p-2 rounded">
                                                <span className="text-sm truncate">{file.name}</span>
                                                <button
                                                    onClick={() => removeImage(index, 'after')}
                                                    className="text-red-500 hover:text-red-700"
                                                >
                                                    <X size={16} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
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
                                <h3 className="text-lg font-semibold mb-4">
                                    {selectedPost.fields.Title || selectedPost.fields['Post Id']}
                                </h3>
                                {selectedPost.fields.Content ? (
                                    <div 
                                        className="prose max-w-none"
                                        style={{
                                            maxWidth: '100%',
                                            overflowX: 'hidden',
                                            wordWrap: 'break-word'
                                        }}
                                        dangerouslySetInnerHTML={{ __html: selectedPost.fields.Content }}
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
