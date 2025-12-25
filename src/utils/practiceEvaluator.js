// backend/src/utils/practiceEvaluator.js
export const evaluateAnswers = (questions, userAnswers, negativeMarking = false) => {
  let totalMarks = 0;
  let scoredMarks = 0;
  const results = [];

  const userAnswerMap = new Map();
  userAnswers.forEach(ua => {
    if (ua.question_id != null) {
      const answer = ua.user_answer?.toString().trim();
      userAnswerMap.set(ua.question_id, answer ? answer.toLowerCase() : '');
    }
  });

  questions.forEach(q => {
    const questionId = q.question_id;
    const questionType = q.question_type.toUpperCase();
    const correctAnswer = q.correct_answer.toString().trim().toLowerCase();
    const marks = Number(q.marks);
    const userAnswer = userAnswerMap.get(questionId) || '';

    totalMarks += marks;

    let isCorrect = false;
    let gainedMarks = 0;

    if (questionType === 'MCQ') {
      if (userAnswer === correctAnswer) {
        isCorrect = true;
        gainedMarks = marks;
      } else if (userAnswer !== '' && negativeMarking) {
        gainedMarks = marks === 1 ? -1/3 : -2/3; 
      }
    } else if (questionType === 'MSQ') {
      const sortedCorrect = correctAnswer.split('').sort().join('');
      const sortedUser = userAnswer.split('').sort().join('');
      if (sortedUser === sortedCorrect && userAnswer.length > 0) {
        isCorrect = true;
        gainedMarks = marks;
      }
    } else if (questionType === 'NAT') {
      const correctNum = parseFloat(correctAnswer);
      const userNum = parseFloat(userAnswer);
      if (!isNaN(correctNum) && !isNaN(userNum) && correctNum === userNum) {
        isCorrect = true;
        gainedMarks = marks;
      }
    }

    scoredMarks += gainedMarks;

    results.push({
      question_id: questionId,
      correct_answer: q.correct_answer, 
      user_answer: userAnswerMap.get(questionId) || null,
      is_correct: isCorrect,
      gained_marks: Number(gainedMarks.toFixed(2))
    });
  });

  const finalScore = Number(scoredMarks.toFixed(2)); // Allow negative
  const thresholdPercentage = questions[0]?.threshold_percentage || 50;
  const thresholdMarks = Number(((thresholdPercentage * totalMarks) / 100).toFixed(2));
  const passed = finalScore >= thresholdMarks;

  return {
    results,
    total_marks: totalMarks,
    scored_marks: finalScore,
    threshold_percentage: thresholdPercentage,
    threshold_marks: thresholdMarks,
    passed
  };
};