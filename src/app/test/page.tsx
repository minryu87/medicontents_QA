export default function TestPage() {
  return (
    <div className="min-h-screen bg-blue-100 flex items-center justify-center">
      <div className="bg-white p-8 rounded-lg shadow-lg">
        <h1 className="text-2xl font-bold text-gray-800 mb-4">테스트 페이지</h1>
        <p className="text-gray-600">이 페이지가 보인다면 Next.js가 정상적으로 작동하고 있습니다.</p>
        <div className="mt-4 p-4 bg-green-100 rounded">
          <p className="text-green-800">✅ 렌더링 성공!</p>
        </div>
      </div>
    </div>
  );
}
