'use client';

import React, { useState, ChangeEvent, useEffect } from 'react';
import { Upload, Send, FileText, CheckCircle, XCircle, X } from 'lucide-react';

// Airtable 설정
const AIRTABLE_API_KEY = 'pat6S8lzX8deRFTKC.0e92c4403cdc7878f8e61f815260852d4518a0b46fa3de2350e5e91f4f0f6af9';
const AIRTABLE_BASE_ID = 'appa5Q0PYdL5VY3RK';

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
    conceptMessage: string;
    patientCondition: string;
    treatmentProcessMessage: string;
    treatmentResultMessage: string;
    additionalMessage: string;
    beforeImagesText: string;
    processImagesText: string;
    afterImagesText: string;
}

// 이미지 파일 타입 정의
interface ImageFile {
    file: File;
    preview: string;
    id?: string; // Airtable에 업로드된 후의 ID
}

// 포스팅 생성 폼 컴포넌트
const PostCreationForm: React.FC = () => {
    const [formData, setFormData] = useState<FormData>({
        treatmentType: '',
        conceptMessage: '',
        patientCondition: '',
        treatmentProcessMessage: '',
        treatmentResultMessage: '',
        additionalMessage: '',
        beforeImagesText: '',
        processImagesText: '',
        afterImagesText: ''
    });
    
    const [images, setImages] = useState<{
        beforeImages: ImageFile[];
        processImages: ImageFile[];
        afterImages: ImageFile[];
    }>({
        beforeImages: [],
        processImages: [],
        afterImages: []
    });
    
    const [loading, setLoading] = useState<boolean>(false);
    const [success, setSuccess] = useState<boolean>(false);
    const [error, setError] = useState<string>('');
    const [isClient, setIsClient] = useState<boolean>(false);

    // 클라이언트 사이드에서만 실행
    useEffect(() => {
        setIsClient(true);
    }, []);

    const treatmentTypes = [
        { value: '신경치료', label: '신경치료' },
        { value: '임플란트', label: '임플란트' },
        { value: '교정치료', label: '교정치료' },
        { value: '보철치료', label: '보철치료' },
        { value: '예방치료', label: '예방치료' }
    ];

    const handleSubmit = async (): Promise<void> => {
        if (!formData.treatmentType) {
            setError('진료 유형을 선택해주세요.');
            return;
        }

        setLoading(true);
        setError('');
        
        try {
            const postId = generatePostId();
            console.log('생성된 Post ID:', postId);
            
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
            
            console.log('Medicontent Posts 생성 데이터:', medicontentPostData);
            const medicontentResult = await createMedicontentPost(medicontentPostData);
            console.log('Medicontent Posts 생성 결과:', medicontentResult);
            
            // 2. Post Data Requests 테이블에 데이터 생성 (이미지 없이 먼저 생성)
            const postDataRequestData = {
                fields: {
                    'Post ID': postId,
                    'Concept Message': formData.conceptMessage || '',
                    'Patient Condition': formData.patientCondition || '',
                    'Treatment Process Message': formData.treatmentProcessMessage || '',
                    'Treatment Result Message': formData.treatmentResultMessage || '',
                    'Additional Message': formData.additionalMessage || '',
                    'Before Images': [],
                    'Process Images': [],
                    'After Images': [],
                    'Before Images Texts': formData.beforeImagesText || '',
                    'Process Images Texts': formData.processImagesText || '',
                    'After Images Texts': formData.afterImagesText || '',
                    'Status': '대기'
                }
            };
            
            console.log('Post Data Requests 생성 데이터:', postDataRequestData);
            const postDataRequestResult = await createPostDataRequest(postDataRequestData);
            console.log('Post Data Requests 생성 결과:', postDataRequestResult);
            
            // 3. 생성된 레코드에 이미지들을 업로드
            const recordId = postDataRequestResult.id;
            
            // Before Images 업로드
            for (const imageFile of images.beforeImages) {
                if (!imageFile.id) {
                    try {
                        const imageId = await uploadImageToAirtable(imageFile.file, recordId, 'Before Images');
                        console.log('Before Image 업로드 성공:', imageId);
                    } catch (error) {
                        console.error('Before Image 업로드 실패:', error);
                    }
                }
            }

            // Process Images 업로드
            for (const imageFile of images.processImages) {
                if (!imageFile.id) {
                    try {
                        const imageId = await uploadImageToAirtable(imageFile.file, recordId, 'Process Images');
                        console.log('Process Image 업로드 성공:', imageId);
                    } catch (error) {
                        console.error('Process Image 업로드 실패:', error);
                    }
                }
            }

            // After Images 업로드
            for (const imageFile of images.afterImages) {
                if (!imageFile.id) {
                    try {
                        const imageId = await uploadImageToAirtable(imageFile.file, recordId, 'After Images');
                        console.log('After Image 업로드 성공:', imageId);
                    } catch (error) {
                        console.error('After Image 업로드 실패:', error);
                    }
                }
            }
            
            setSuccess(true);
            
            // 폼 초기화
            setFormData({
                treatmentType: '',
                conceptMessage: '',
                patientCondition: '',
                treatmentProcessMessage: '',
                treatmentResultMessage: '',
                additionalMessage: '',
                beforeImagesText: '',
                processImagesText: '',
                afterImagesText: ''
            });
            
            setImages({
                beforeImages: [],
                processImages: [],
                afterImages: []
            });
            
        } catch (error) {
            console.error('포스팅 생성 실패:', error);
            setError('포스팅 생성에 실패했습니다. 다시 시도해주세요.');
        } finally {
            setLoading(false);
        }
    };

    const handleInputChange = (field: keyof FormData, value: string): void => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleImageUpload = (type: 'beforeImages' | 'processImages' | 'afterImages', files: FileList | null): void => {
        if (files) {
            const newImages: ImageFile[] = Array.from(files).map(file => ({
                file,
                preview: URL.createObjectURL(file)
            }));
            
            setImages(prev => ({
                ...prev,
                [type]: [...prev[type], ...newImages]
            }));
        }
    };

    const removeImage = (type: 'beforeImages' | 'processImages' | 'afterImages', index: number): void => {
        setImages(prev => {
            const updatedImages = [...prev[type]];
            // 미리보기 URL 해제
            URL.revokeObjectURL(updatedImages[index].preview);
            updatedImages.splice(index, 1);
            return {
                ...prev,
                [type]: updatedImages
            };
        });
    };

    const handleFileClick = (inputId: string): void => {
        if (isClient) {
            const input = document.getElementById(inputId) as HTMLInputElement;
            if (input) {
                input.click();
            }
        }
    };

    if (!isClient) {
        return (
            <div className="bg-white p-6 rounded-xl shadow-sm">
                <div className="animate-pulse">
                    <div className="h-8 bg-gray-200 rounded mb-4"></div>
                    <div className="h-4 bg-gray-200 rounded mb-2"></div>
                    <div className="h-4 bg-gray-200 rounded mb-2"></div>
                    <div className="h-4 bg-gray-200 rounded"></div>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white p-6 rounded-xl shadow-sm">
            <h2 className="text-2xl font-bold text-gray-800 mb-6">포스팅 생성하기</h2>
            
            {/* 수동 생성하기 */}
            <div className="mb-8">
                <h3 className="text-xl font-semibold text-gray-700 mb-4">수동 생성하기</h3>
                
                {success && (
                    <div className="mb-4 bg-green-50 border-l-4 border-green-400 p-4 rounded-r-lg">
                        <div className="flex">
                            <CheckCircle className="h-6 w-6 text-green-500 mr-3" />
                            <div>
                                <p className="font-bold text-green-800">포스팅이 성공적으로 생성되었습니다!</p>
                                <p className="text-sm text-green-700 mt-1">하단의 포스팅 검토하기에서 확인할 수 있습니다.</p>
                            </div>
                        </div>
                    </div>
                )}
                
                {error && (
                    <div className="mb-4 bg-red-50 border-l-4 border-red-400 p-4 rounded-r-lg">
                        <div className="flex">
                            <XCircle className="h-6 w-6 text-red-500 mr-3" />
                            <div>
                                <p className="font-bold text-red-800">오류가 발생했습니다</p>
                                <p className="text-sm text-red-700 mt-1">{error}</p>
                            </div>
                        </div>
                    </div>
                )}
                
                <form className="space-y-6">
                    {/* 진료 유형 선택 */}
                    <div>
                        <label className="block font-bold mb-2 text-gray-800">
                            진료 유형 선택
                        </label>
                        <select
                            value={formData.treatmentType}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => handleInputChange('treatmentType', e.target.value)}
                            className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        >
                            <option value="">진료 유형을 선택하세요</option>
                            {treatmentTypes.map((type) => (
                                <option key={type.value} value={type.value}>
                                    {type.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block font-bold mb-2 text-gray-800">
                            1. 질환에 대한 개념 설명에서 강조되어야 할 메시지가 있나요?
                        </label>
                        <textarea
                            value={formData.conceptMessage}
                            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => handleInputChange('conceptMessage', e.target.value)}
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
                            value={formData.patientCondition}
                            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => handleInputChange('patientCondition', e.target.value)}
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
                                onClick={() => handleFileClick('beforeImages')}
                            >
                                <Upload className="mx-auto text-gray-400" size={28} />
                                <p className="text-sm text-gray-500 mt-2">이미지 업로드</p>
                                <input 
                                    id="beforeImages"
                                    type="file" 
                                    className="hidden" 
                                    multiple 
                                    accept="image/*"
                                    onChange={(e) => handleImageUpload('beforeImages', e.target.files)}
                                />
                            </div>
                            <div className="md:col-span-3">
                                <textarea
                                    value={formData.beforeImagesText}
                                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => handleInputChange('beforeImagesText', e.target.value)}
                                    rows={4}
                                    placeholder="파노라마, X-ray, 구강 내 사진 등과 함께 어떤 상태였는지 간략하게 작성해주세요."
                                    className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none h-full"
                                />
                            </div>
                        </div>
                        {/* 이미지 미리보기 */}
                        {images.beforeImages.length > 0 && (
                            <div className="mt-4">
                                <p className="text-sm font-medium text-gray-700 mb-2">업로드된 이미지 ({images.beforeImages.length}개):</p>
                                <div className="flex flex-wrap gap-2">
                                    {images.beforeImages.map((image, index) => (
                                        <div key={index} className="relative">
                                            <img 
                                                src={image.preview} 
                                                alt={`Before ${index + 1}`}
                                                className="w-20 h-20 object-cover rounded border"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => removeImage('beforeImages', index)}
                                                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs hover:bg-red-600"
                                            >
                                                <X size={12} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    <div>
                        <label className="block font-bold mb-2 text-gray-800">
                            4. 치료 과정에서 강조되어야 할 메시지가 있나요?
                        </label>
                        <textarea
                            value={formData.treatmentProcessMessage}
                            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => handleInputChange('treatmentProcessMessage', e.target.value)}
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
                                onClick={() => handleFileClick('processImages')}
                            >
                                <Upload className="mx-auto text-gray-400" size={28} />
                                <p className="text-sm text-gray-500 mt-2">이미지 업로드</p>
                                <input 
                                    id="processImages"
                                    type="file" 
                                    className="hidden" 
                                    multiple 
                                    accept="image/*"
                                    onChange={(e) => handleImageUpload('processImages', e.target.files)}
                                />
                            </div>
                            <div className="md:col-span-3">
                                <textarea
                                    value={formData.processImagesText}
                                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => handleInputChange('processImagesText', e.target.value)}
                                    rows={4}
                                    placeholder="미세 현미경 사용 모습, MTA 충전 과정 등 치료 과정 사진과 함께 설명을 작성해주세요."
                                    className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none h-full"
                                />
                            </div>
                        </div>
                        {/* 이미지 미리보기 */}
                        {images.processImages.length > 0 && (
                            <div className="mt-4">
                                <p className="text-sm font-medium text-gray-700 mb-2">업로드된 이미지 ({images.processImages.length}개):</p>
                                <div className="flex flex-wrap gap-2">
                                    {images.processImages.map((image, index) => (
                                        <div key={index} className="relative">
                                            <img 
                                                src={image.preview} 
                                                alt={`Process ${index + 1}`}
                                                className="w-20 h-20 object-cover rounded border"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => removeImage('processImages', index)}
                                                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs hover:bg-red-600"
                                            >
                                                <X size={12} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    <div>
                        <label className="block font-bold mb-2 text-gray-800">
                            6. 치료 결과에 대해 강조되어야 할 메시지가 있나요?
                        </label>
                        <textarea
                            value={formData.treatmentResultMessage}
                            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => handleInputChange('treatmentResultMessage', e.target.value)}
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
                                onClick={() => handleFileClick('afterImages')}
                            >
                                <Upload className="mx-auto text-gray-400" size={28} />
                                <p className="text-sm text-gray-500 mt-2">이미지 업로드</p>
                                <input 
                                    id="afterImages"
                                    type="file" 
                                    className="hidden" 
                                    multiple 
                                    accept="image/*"
                                    onChange={(e) => handleImageUpload('afterImages', e.target.files)}
                                />
                            </div>
                            <div className="md:col-span-3">
                                <textarea
                                    value={formData.afterImagesText}
                                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => handleInputChange('afterImagesText', e.target.value)}
                                    rows={4}
                                    placeholder="치료 전/후 비교 X-ray, 구강 내 사진 등 치료 결과 사진과 함께 설명을 작성해주세요."
                                    className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none h-full"
                                />
                            </div>
                        </div>
                        {/* 이미지 미리보기 */}
                        {images.afterImages.length > 0 && (
                            <div className="mt-4">
                                <p className="text-sm font-medium text-gray-700 mb-2">업로드된 이미지 ({images.afterImages.length}개):</p>
                                <div className="flex flex-wrap gap-2">
                                    {images.afterImages.map((image, index) => (
                                        <div key={index} className="relative">
                                            <img 
                                                src={image.preview} 
                                                alt={`After ${index + 1}`}
                                                className="w-20 h-20 object-cover rounded border"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => removeImage('afterImages', index)}
                                                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs hover:bg-red-600"
                                            >
                                                <X size={12} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    <div>
                        <label className="block font-bold mb-2 text-gray-800">
                            8. 추가적으로 더하고 싶은 메시지가 있나요?
                        </label>
                        <textarea
                            value={formData.additionalMessage}
                            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => handleInputChange('additionalMessage', e.target.value)}
                            rows={3}
                            placeholder="환자 당부사항, 병원 철학 등 자유롭게 작성해주세요."
                            className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        />
                    </div>

                    <div className="pt-4">
                        <button
                            type="button"
                            onClick={handleSubmit}
                            disabled={loading}
                            className={`w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-semibold transition-colors ${
                                loading
                                    ? 'bg-gray-400 text-white cursor-not-allowed'
                                    : 'bg-blue-600 text-white hover:bg-blue-700'
                            }`}
                        >
                            {loading ? (
                                <>
                                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                                    생성 중...
                                </>
                            ) : (
                                <>
                                    <Send size={20} />
                                    생성하기
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// 포스팅 검토 영역 컴포넌트
const PostReviewSection: React.FC = () => {
    return (
        <div className="bg-white p-6 rounded-xl shadow-sm">
            <h2 className="text-2xl font-bold text-gray-800 mb-6">포스팅 검토하기</h2>
            <div className="text-center py-12 text-gray-500">
                <FileText size={48} className="mx-auto mb-4" />
                <p className="text-xl font-semibold">포스팅 검토 기능</p>
                <p className="mt-2">생성된 포스팅을 검토하고 관리할 수 있는 영역입니다.</p>
                <p className="text-sm mt-4">(구현 예정)</p>
            </div>
        </div>
    );
};

// 메인 페이지 컴포넌트
export default function MedicontentsQAPage(): JSX.Element {
    return (
        <div className="min-h-screen bg-gray-50/50 font-sans">
            <header className="page-header flex flex-col items-start gap-4 px-6 sm:flex-row sm:items-center sm:justify-between md:px-8" style={{ marginBottom: '1.5rem' }}>
                <h1 className="text-2xl font-bold text-gray-900">메디컨텐츠 QA 데모</h1>
            </header>
            
            <div className="space-y-8 px-6 md:px-8">
                {/* 포스팅 생성하기 */}
                <PostCreationForm />
                
                {/* 포스팅 검토하기 */}
                <PostReviewSection />
            </div>
        </div>
    );
}
